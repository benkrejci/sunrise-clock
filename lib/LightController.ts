/**
 * Handles communication with arduino which manages:
 * - RGB LED PWM output
 * - Ambient light sensor (which rejects its own RGB output)
 */

import i2c from 'i2c-bus'
import _ from 'lodash'
import { TypedEmitter } from 'tiny-typed-emitter'

const DEFAULT_I2C_ADDRESS = 0x33
const DEFAULT_I2C_BUS = 1
const I2C_CMD_SET_LED = 0x02
const I2C_CMD_GET_LIGHT_LEVELS = 0x03
const I2C_CMD_SET_MOVING_AVERAGE_PERIOD_MS = 0x04

const DEFAULT_POLL_PERIOD_MS = 400
//                             max fps ⤵
const DEFAULT_PAINT_PERIOD_MS = 1000 / 20
const BRIGHTNESS_EASE_COEFFICIENT = (1 / 1000) * DEFAULT_PAINT_PERIOD_MS
const BRIGHTNESS_EASE_MAX = (1 / 2000) * DEFAULT_PAINT_PERIOD_MS
const MOVING_AVERAGE_PERIOD_MS = 1600
const SENSOR_VALUE_DELTA_THRESHOLD = 5

export type Rgbw<V = number> = [V, V, V, V]

export const RGBW_OFF: Rgbw = [0, 0, 0, 0]
export const RGBW_BRIGHT: Rgbw = [200, 140, 60, 255]

export interface LightLevels {
    ambient: number
    cumulative: number
}
export const LIGHT_LEVEL_TYPES: Array<keyof LightLevels> = [
    'ambient',
    'cumulative',
]

export const linear = (
    x: number,
    xStart: number,
    xEnd: number,
    yStart: number,
    yEnd: number,
): number => ((x - xStart) / (xEnd - xStart)) * (yEnd - yStart) + yStart
export const linearColor = (
    x: number,
    xStart: number,
    xEnd: number,
    rgbwStart: Rgbw,
    rgbwEnd: Rgbw,
): Rgbw =>
    <Rgbw>(
        rgbwStart.map((value, colorIndex) =>
            linear(x, xStart, xEnd, value, rgbwEnd[colorIndex]),
        )
    )

interface LightControllerEvents {
    ready: () => void
    'update.brightness': (zeroToOneLevels: LightLevels) => void
}

export class LightController extends TypedEmitter<LightControllerEvents> {
    private i2c: i2c.PromisifiedBus | null = null

    private readonly i2cAddress: number
    private readonly pollPeriodMs: number
    private readonly paintPeriodMs: number

    private isReady = false
    private brightnessLevels: LightLevels = { ambient: 0, cumulative: 0 }
    private lastLightLevels: LightLevels = { ambient: 0, cumulative: 0 }
    private nextLightLevels: LightLevels = { ambient: 0, cumulative: 0 }
    private easedBrightnessLevels: LightLevels = { ambient: 0, cumulative: 0 }
    private easedBrightnessLevelDerivatives: LightLevels = {
        ambient: 0,
        cumulative: 0,
    }
    private lastReadMs: number = 0
    private lastPaintMs: number = 0
    private sensorLoopTimeout: NodeJS.Timeout | null = null
    private paintLoopTimeout: NodeJS.Timeout | null = null

    constructor({
        i2cBus = DEFAULT_I2C_BUS,
        i2cAddress = DEFAULT_I2C_ADDRESS,
        pollPeriodMs = DEFAULT_POLL_PERIOD_MS,
        paintPeriodMs = DEFAULT_PAINT_PERIOD_MS,
    }: {
        i2cBus?: number
        i2cAddress?: number
        pollPeriodMs?: number
        paintPeriodMs?: number
    }) {
        super()

        this.i2cAddress = i2cAddress
        this.pollPeriodMs = pollPeriodMs
        this.paintPeriodMs = paintPeriodMs

        this.initI2c(i2cBus, () => {
            this.setMovingAveragePeriod(MOVING_AVERAGE_PERIOD_MS)
            this.sensorLoop()
            this.paintLoop()

            this.isReady = true
            this.emit('ready')
        })
    }

    public ready(callback: () => void): void {
        if (this.isReady) callback.call(this)
        else this.on('ready', callback)
    }

    public getBrightnessLevels(): LightLevels {
        return this.easedBrightnessLevels
    }

    public async setRgbw(rgbw: Rgbw): Promise<void> {
        this.sendCommand(I2C_CMD_SET_LED, rgbw)
    }

    public stop(): void {
        if (this.sensorLoopTimeout !== null)
            clearTimeout(this.sensorLoopTimeout)
        if (this.paintLoopTimeout !== null) clearTimeout(this.paintLoopTimeout)
    }

    private async initI2c(i2cBus: number, callback: () => void): Promise<void> {
        this.i2c = await i2c.openPromisified(i2cBus)
        callback()
    }

    private async setMovingAveragePeriod(periodMs: number) {
        this.sendCommand(I2C_CMD_SET_MOVING_AVERAGE_PERIOD_MS, [periodMs])
    }

    private async sendCommand(cmd: number, message: number[]) {
        if (!this.i2c) throw new Error('i2c not initialized')
        const buffer = Buffer.from(message)
        await this.i2c.writeI2cBlock(
            this.i2cAddress,
            cmd,
            buffer.length,
            buffer,
        )
    }

    private async getLightLevels(): Promise<LightLevels> {
        let ambient: number
        let cumulative: number
        try {
            if (!this.i2c) throw new Error('i2c not initialized')
            // first 2 bytes are ambient light value, next 2 are regular light value
            const buffer = Buffer.alloc(4)
            await this.i2c.readI2cBlock(
                this.i2cAddress,
                I2C_CMD_GET_LIGHT_LEVELS,
                4,
                buffer,
            )
            ambient = LightController.bytesToInteger(buffer[0], buffer[1])
            cumulative = LightController.bytesToInteger(buffer[2], buffer[3])
        } catch (error) {
            console.warn('Light sensor read error:', error)
            return Promise.reject()
        }
        return { ambient, cumulative }
    }

    private async sensorLoop(): Promise<void> {
        const startMs = +new Date()

        let newLevels: LightLevels | null = null
        try {
            newLevels = await this.getLightLevels()
        } catch (error) {}

        LIGHT_LEVEL_TYPES.forEach((levelType) => {
            this.lastLightLevels[levelType] = this.nextLightLevels[levelType]
            if (newLevels === null || newLevels[levelType] === null) return
            if (
                Math.abs(
                    this.lastLightLevels[levelType] - newLevels[levelType],
                ) > SENSOR_VALUE_DELTA_THRESHOLD
            ) {
                this.nextLightLevels[levelType] = newLevels[levelType]
                this.brightnessLevels[
                    levelType
                ] = LightController.sensorValueToBrightness(
                    newLevels[levelType],
                )
            }
        })

        this.lastReadMs = +new Date()
        const elapsedMs = this.lastReadMs - startMs
        const waitMs = Math.max(0, this.pollPeriodMs - elapsedMs)
        this.sensorLoopTimeout = setTimeout(this.sensorLoop.bind(this), waitMs)
    }

    private async paintLoop(): Promise<void> {
        const startMs = +new Date()

        LIGHT_LEVEL_TYPES.forEach((levelType) => {
            let dldt =
                BRIGHTNESS_EASE_COEFFICIENT *
                (this.brightnessLevels[levelType] -
                    this.easedBrightnessLevels[levelType])
            let d2ldt2 = dldt - this.easedBrightnessLevelDerivatives[levelType]
            if (d2ldt2 > BRIGHTNESS_EASE_MAX) {
                d2ldt2 = BRIGHTNESS_EASE_MAX
            } else if (d2ldt2 < -BRIGHTNESS_EASE_MAX) {
                d2ldt2 = -BRIGHTNESS_EASE_MAX
            }
            dldt = this.easedBrightnessLevelDerivatives[levelType] += d2ldt2

            this.easedBrightnessLevels[levelType] += dldt
        })

        this.emit('update.brightness', this.easedBrightnessLevels)

        this.lastPaintMs = +new Date()
        const elapsedMs = this.lastPaintMs - startMs
        const waitMs = Math.max(0, this.paintPeriodMs - elapsedMs)
        this.paintLoopTimeout = setTimeout(this.paintLoop.bind(this), waitMs)
    }

    private static sensorValueToBrightness(sensorValue: number): number {
        // graph: https://www.desmos.com/calculator/ljd9bskfs8
        return _.clamp(
            -12845.8 * Math.pow(sensorValue, -1.58938) + 1.21132,
            0,
            1,
        )
    }

    private static bytesToInteger(...bytes: number[]) {
        if (bytes.length > 4)
            throw new TypeError(
                'Too many bytes; JS uses 32-bit integers (4 bytes)',
            )
        let byteIndex = 0
        let output = bytes[byteIndex]
        let byte
        while ((byte = bytes[++byteIndex])) {
            output |= byte << (8 * byteIndex)
        }
        return output
    }
}
