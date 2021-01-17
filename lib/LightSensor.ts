import Bh1750 from 'bh1750_lux'
import { TypedEmitter } from 'tiny-typed-emitter'

const DEFAULT_I2C_ADDRESS = 0x23
const DEFAULT_I2C_BUS = 1
const DEFAULT_POLL_PERIOD_MS = 120 // sensor updates every ~120ms
const MOVING_AVERAGE_N = 3

//                         max FPS ⤵
const MIN_FRAME_PERIOD_MS = 1000 / 40

interface LightSensorEvents {
    update: (zeroToOne: number) => void
}

export class LightSensor extends TypedEmitter<LightSensorEvents> {
    private readonly sensor: Bh1750
    private readonly pollPeriodMs: number
    private readonly luxReadings: number[] = []

    private brightness: number = 0
    private nextBrightness: number = 0
    private lastBrightness: number = 0
    private lastReadMs: number = 0
    private sensorLoopTimeout: NodeJS.Timeout | null = null
    private paintLoopTimeout: NodeJS.Timeout | null = null

    constructor({
        i2cBus = DEFAULT_I2C_BUS,
        i2cAddress = DEFAULT_I2C_ADDRESS,
        pollPeriodMs = DEFAULT_POLL_PERIOD_MS,
    }: {
        i2cBus?: number
        i2cAddress?: number
        pollPeriodMs?: number
    }) {
        super()

        this.pollPeriodMs = pollPeriodMs

        this.sensor = new Bh1750({
            addr: i2cAddress,
            bus: i2cBus,
        })

        this.sensorLoop()
        this.paintLoop()
    }

    public getBrightness(): number {
        return this.brightness
    }

    public stop(): void {
        if (this.sensorLoopTimeout !== null)
            clearTimeout(this.sensorLoopTimeout)
        if (this.paintLoopTimeout !== null) clearTimeout(this.paintLoopTimeout)
    }

    private async getLux(): Promise<number> {
        let lux: number
        try {
            lux = await this.sensor.readLight()
        } catch (error) {
            console.warn('Light sensor read error:')
            return Promise.reject()
        }
        this.luxReadings.push(lux)
        if (this.luxReadings.length < MOVING_AVERAGE_N) return lux
        else if (this.luxReadings.length > MOVING_AVERAGE_N)
            this.luxReadings.shift()
        return (
            this.luxReadings.reduce((prev, cur) => prev + cur) /
            this.luxReadings.length
        )
    }

    private async sensorLoop(): Promise<void> {
        const startMs = +new Date()
        let lux: number | null = null
        try {
            lux = await this.getLux()
            console.log(`lux: ${lux}`)
        } catch (error) {}

        this.lastBrightness = this.nextBrightness
        if (lux !== null) {
            this.nextBrightness = LightSensor.luxToBrightness(lux)
        }

        this.lastReadMs = +new Date()
        const elapsedMs = this.lastReadMs - startMs
        const waitMs = Math.max(0, this.pollPeriodMs - elapsedMs)
        this.sensorLoopTimeout = setTimeout(this.sensorLoop.bind(this), waitMs)
    }

    private paintLoop(): void {
        const startMs = +new Date()
        this.brightness =
            ((startMs - this.lastReadMs) / this.pollPeriodMs) *
                (this.nextBrightness - this.lastBrightness) +
            this.lastBrightness
        this.emit('update', this.brightness)

        const elapsedMs = +new Date() - startMs
        const waitMs = Math.max(0, MIN_FRAME_PERIOD_MS - elapsedMs)
        this.paintLoopTimeout = setTimeout(this.paintLoop.bind(this), waitMs)
    }

    private static luxToBrightness(lux: number): number {
        return Math.max(0, 0.13 * Math.log(lux) - 0.0967)
    }
}
