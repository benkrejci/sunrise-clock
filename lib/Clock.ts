import fs from 'fs'
import pigpio, { Gpio } from 'pigpio'

import { Ambient } from './Ambient'
import { debounce } from './decorators'
import { Display } from './Display'
import { LightController, Rgbw, RGBW_OFF } from './LightController'
import { RotaryEncoder } from './RotaryEncoder'
import { Sunrise } from './Sunrise'

import Timeout = NodeJS.Timeout
interface ClockState {
    alarmTimeMinutes?: number
}

const DEFAULT_ALARM_BUTTON_PIN = 10
const DEFAULT_ALARM_LED_PIN = 24
const DEFAULT_ROTARY_CW_PIN = 14
const DEFAULT_ROTARY_CCW_PIN = 15
const DEFAULT_ROTARY_BUTTON_PIN = 18
const DEFAULT_AMBIENT_TOGGLE_PIN = 25

const DEFAULT_DISPLAY_BRIGHTNESS = 0.1
const DEFAULT_CLOCK_STATE_FILE_PATH = '/var/lib/sunrise-clock-state.json'
const DEFAULT_SHOW_ALARM_DELAY_MS = 2 * 1000
const DEFAULT_ROTARY_SPEED = 1 / 3
const DEFAULT_ALARM_MINUTES = 10 * 60
const DEFAULT_ENCODER_MODE = 'MINUTES'

const BUTTON_DEBOUNCE_NS = 100 * 1000
const DAY_MINUTES = 60 * 24
const ACTIVE_LED_MIN_BRIGHTNESS = 0.02
const DISPLAY_BRIGHTNESS_SCALE = 1
const DISPLAY_GAMMA_POW = 2.2

// the following values are taken from this table: https://github.com/fivdi/pigpio/blob/master/doc/gpio.md#pwmrangerange
// they are chosen so as to maximize color resolution and minimize flicker
const PWM_SAMPLE_LENGTH_US = 1
const PWM_FREQUENCY = 1000
const PWM_RANGE = 1000

pigpio.configureClock(PWM_SAMPLE_LENGTH_US, pigpio.CLOCK_PCM)

export class Clock {
    private readonly clockStateFilePath: string
    private readonly showAlarmDelayMs: number
    private readonly display: Display
    private readonly sunrise: Sunrise
    private readonly ambient?: Ambient
    private readonly lightController: LightController
    private readonly alarmButton: Gpio
    private readonly alarmLed?: Gpio

    private displayBrightess: number = DEFAULT_DISPLAY_BRIGHTNESS
    private editMode: null | 'MINUTES' | 'HOURS' = null
    private editOffset: number = 0
    private alarmTimeMinutes: number = DEFAULT_ALARM_MINUTES
    private showTimeTimeout: Timeout | null = null

    constructor({
        i2cBus,
        displayAddress,
        lightControllerAddress,
        rotaryCwPin = DEFAULT_ROTARY_CW_PIN,
        rotaryCcwPin = DEFAULT_ROTARY_CCW_PIN,
        rotaryButtonPin = DEFAULT_ROTARY_BUTTON_PIN,
        rotarySpeed = DEFAULT_ROTARY_SPEED,
        alarmButtonPin = DEFAULT_ALARM_BUTTON_PIN,
        alarmLedPin = DEFAULT_ALARM_LED_PIN,
        ambientTogglePin = DEFAULT_AMBIENT_TOGGLE_PIN,
        displayBrightness = DEFAULT_DISPLAY_BRIGHTNESS,
        clockStateFilePath = DEFAULT_CLOCK_STATE_FILE_PATH,
        showAlarmDelayMs = DEFAULT_SHOW_ALARM_DELAY_MS,
    }: {
        i2cBus?: number
        displayAddress?: number
        lightControllerAddress?: number
        rotaryCwPin?: number
        rotaryCcwPin?: number
        rotaryButtonPin?: number
        rotarySpeed?: number
        redPin?: number | null
        greenPin?: number | null
        bluePin?: number | null
        whitePin?: number | null
        alarmButtonPin?: number
        alarmLedPin?: number | null
        ambientTogglePin?: number | null
        displayBrightness?: number
        clockStateFilePath?: string
        showAlarmDelayMs?: number
    } = {}) {
        this.clockStateFilePath = clockStateFilePath
        this.showAlarmDelayMs = showAlarmDelayMs

        this.alarmButton = new Gpio(alarmButtonPin, {
            mode: Gpio.INPUT,
            pullUpDown: Gpio.PUD_UP,
            alert: true,
        })
        this.alarmButton.glitchFilter(BUTTON_DEBOUNCE_NS)
        this.alarmButton.on('alert', () => this.updateActive())

        if (alarmLedPin !== null) {
            this.alarmLed = new Gpio(alarmLedPin, { mode: Gpio.OUTPUT })
            this.alarmLed.pwmFrequency(PWM_FREQUENCY)
            this.alarmLed.pwmRange(PWM_RANGE)
        }

        this.display = new Display({ i2cBus, i2cAddress: displayAddress })

        const encoder = new RotaryEncoder(
            rotaryCwPin,
            rotaryCcwPin,
            rotaryButtonPin,
        )
        let lastAlarmTimeMinutes: number
        encoder.on('release', () => {
            this.editMode = this.editMode === 'MINUTES' ? 'HOURS' : 'MINUTES'
            this.editOffset = 0
            lastAlarmTimeMinutes = this.alarmTimeMinutes

            this.updateAlarmTime()
        })
        encoder.on('rotate', (delta) => {
            if (this.editMode === null) {
                this.editMode = DEFAULT_ENCODER_MODE
                this.editOffset = 0
                lastAlarmTimeMinutes = this.alarmTimeMinutes
            }
            this.editOffset += delta * rotarySpeed

            if (this.editMode === 'MINUTES') {
                this.alarmTimeMinutes =
                    lastAlarmTimeMinutes + Math.round(this.editOffset)
            } else {
                this.alarmTimeMinutes =
                    lastAlarmTimeMinutes + Math.round(this.editOffset) * 60
            }

            if (this.alarmTimeMinutes < 0) this.alarmTimeMinutes += DAY_MINUTES
            else if (this.alarmTimeMinutes >= DAY_MINUTES)
                this.alarmTimeMinutes %= DAY_MINUTES

            this.updateAlarmTime()
            this.saveClockState()
        })
        this.loadClockState()

        this.lightController = new LightController({
            i2cBus,
            i2cAddress: lightControllerAddress,
        })
        this.lightController.on(
            'update.brightness',
            this.updateDisplayBrightness.bind(this),
        )

        const updateLight = () => {
            const rgbw: Rgbw = this.ambient?.getIsOn()
                ? this.ambient.getRgbw()
                : this.sunrise.getRgbw()
            this.lightController.setRgbw(rgbw)
        }

        this.sunrise = new Sunrise({ autoRun: false })
        this.sunrise.on('update', updateLight)

        if (ambientTogglePin !== null) {
            this.ambient = new Ambient({
                togglePin: ambientTogglePin,
                lightController: this.lightController,
            })
            this.ambient.on('update', updateLight)
        }

        this.lightController.ready(() => {
            this.lightController.setRgbw(RGBW_OFF)

            this.sunrise.run()
            this.updateDisplayBrightness()
            this.run()
        })
    }

    public stop(): void {
        this.lightController?.stop()
        this.sunrise.stop()
        this.display.clear()
        this.alarmLed?.pwmWrite(0)
    }

    private updateDisplayBrightness(): void {
        if (!this.lightController) return
        this.setDisplayBrightness(
            this.lightController.getBrightnessLevels().cumulative,
        )
    }

    private setDisplayBrightness(zeroToOne: number): void {
        this.displayBrightess = zeroToOne
        const brightness =
            DISPLAY_BRIGHTNESS_SCALE *
            Math.pow(this.displayBrightess, DISPLAY_GAMMA_POW)
        this.display.setBrightness(brightness)
        this.updateActive()
    }

    private updateActive(): void {
        const active = 1 - this.alarmButton.digitalRead()
        const brightness = Math.max(
            ACTIVE_LED_MIN_BRIGHTNESS,
            this.displayBrightess,
        )
        this.alarmLed?.pwmWrite(Math.round(active * brightness * PWM_RANGE))
        this.sunrise.setActive(!!active)
    }

    private loadClockState(): void {
        fs.readFile(this.clockStateFilePath, 'utf8', (err, data) => {
            if (!err) {
                try {
                    const { alarmTimeMinutes }: ClockState = JSON.parse(data)
                    if (alarmTimeMinutes !== undefined) {
                        this.alarmTimeMinutes = alarmTimeMinutes
                        this.updateAlarmTime()
                        console.log(`Successfully loaded clock state!`)
                    }
                } catch (err) {
                    console.error(
                        `Error parsing state file ${this.clockStateFilePath}:`,
                        err,
                    )
                }
            }
        })
    }

    @debounce(5 * 1000, 60 * 1000)
    private saveClockState(): void {
        const clockState: ClockState = {
            alarmTimeMinutes: this.alarmTimeMinutes,
        }
        fs.writeFile(
            this.clockStateFilePath,
            JSON.stringify(clockState),
            (err) => {
                if (err) {
                    console.error(
                        `Error saving clock state file ${this.clockStateFilePath}:`,
                        err,
                    )
                } else {
                    console.log(`Successfully saved clock state!`)
                }
            },
        )
    }

    private run(): void {
        // show the current time
        this.updateTime()

        // clear the current timeout to show the time
        if (this.showTimeTimeout !== null) clearTimeout(this.showTimeTimeout)
        this.showTimeTimeout = null

        // set a timeout to update the time at the next minute
        const now = new Date()
        this.showTimeTimeout = setTimeout(() => {
            this.showTimeTimeout = null
            this.run()
        }, (60 - now.getSeconds()) * 1000)
    }

    private updateTime(): void {
        const now = new Date()
        this.display.setTime(now.getHours() * 60 + now.getMinutes())
    }

    private updateAlarmTime(): void {
        // set the sunrise sunup time
        this.sunrise.setSunUpTime(this.alarmTimeMinutes)

        // show the current alarm time
        this.display.setTime(
            this.alarmTimeMinutes,
            this.editMode === 'HOURS',
            false,
            this.editMode === 'MINUTES',
        )

        // clear the current timeout to show the time
        if (this.showTimeTimeout !== null) clearTimeout(this.showTimeTimeout)
        this.showTimeTimeout = null

        // set a timeout to resume showing the time
        this.showTimeTimeout = setTimeout(() => {
            this.showTimeTimeout = null

            this.editMode = null

            this.run()
        }, this.showAlarmDelayMs)
    }
}
