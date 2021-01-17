import { Gpio } from 'pigpio'
import { TypedEmitter } from 'tiny-typed-emitter'

import { linearColor, Rgbw, RGBW_BRIGHT, RGBW_OFF } from './Light'
import { LightSensor } from './LightSensor'

interface AmbientEvents {
    update: (isOn: boolean, rgbw: Rgbw) => void
}

const TOGGLE_DEBOUNCE_NS = 10 * 1000
// this is different from debounce; we'll do the toggle once input has been stable for DEBOUNCE_NS
// but still want to ignore subsequent input changes for the following IGNORE_DELAY_MS
// e.g.:
// 1. momentary button pressed
// 2. DEBOUNCE_NS passes
// 3. toggle initiated
// 4. <IGNORE_MS passes
// 5. button is released (ignored)
const TOGGLE_IGNORE_DELAY_MS = 500

interface BrightnessRgbw {
    brightness: number
    rgbw: Rgbw
}

const DEFAULT_BRIGHTNESS_LEVEL: BrightnessRgbw = {
    brightness: 0.25,
    rgbw: [255, 90, 0, 60],
}
const BRIGHTNESS_LEVELS: Array<BrightnessRgbw> = [
    {
        brightness: 0,
        rgbw: [50, 0, 0, 0],
    },
    {
        brightness: 0.15,
        rgbw: [200, 90, 0, 0],
    },
    DEFAULT_BRIGHTNESS_LEVEL,
    {
        brightness: 0.5,
        rgbw: RGBW_BRIGHT,
    },
]

export class Ambient extends TypedEmitter<AmbientEvents> {
    private readonly toggleInput: Gpio
    private readonly lightSensor?: LightSensor

    private isOn: boolean = false
    private rgbw: Rgbw = RGBW_OFF
    private lastToggle: number = 0

    constructor({
        togglePin,
        lightSensor,
    }: {
        togglePin: number
        lightSensor?: LightSensor
    }) {
        super()

        this.lightSensor = lightSensor

        this.toggleInput = new Gpio(togglePin, {
            mode: Gpio.INPUT,
            pullUpDown: Gpio.PUD_DOWN,
            alert: true,
        })
        this.toggleInput.glitchFilter(TOGGLE_DEBOUNCE_NS)
        this.toggleInput.on('alert', () => this.toggle())
    }

    public getIsOn(): boolean {
        return this.isOn
    }

    public getRgbw(): Rgbw {
        return this.rgbw
    }

    private toggle(): void {
        const now = +new Date()
        if (now - this.lastToggle < TOGGLE_IGNORE_DELAY_MS) return
        this.lastToggle = now

        this.isOn = !this.isOn
        if (this.isOn) {
            if (this.lightSensor) {
                this.rgbw = Ambient.calculateRgbw(
                    this.lightSensor.getBrightness(),
                )
            } else {
                this.rgbw = DEFAULT_BRIGHTNESS_LEVEL.rgbw
            }
        } else this.rgbw = RGBW_OFF
        this.updated()
    }

    private updated(): void {
        this.emit('update', this.isOn, this.rgbw)
    }

    private static calculateRgbw(brightness: number): Rgbw {
        for (
            let levelIndex = 0;
            levelIndex < BRIGHTNESS_LEVELS.length;
            levelIndex++
        ) {
            const low = BRIGHTNESS_LEVELS[levelIndex]
            const high = BRIGHTNESS_LEVELS[levelIndex + 1]
            if (!high || brightness < low.brightness) return low.rgbw
            if (brightness < high.brightness)
                return linearColor(
                    brightness,
                    low.brightness,
                    high.brightness,
                    low.rgbw,
                    high.rgbw,
                )
        }
        return BRIGHTNESS_LEVELS[BRIGHTNESS_LEVELS.length - 1].rgbw
    }
}
