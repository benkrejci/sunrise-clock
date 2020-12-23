import fs from 'fs'
import { RotaryEncoder } from './RotaryEncoder'
import { Display } from './Display'
import { Sunrise } from './Sunrise'
import Timeout = NodeJS.Timeout
import { debounce } from './decorators'
import pigpio, { Gpio } from 'pigpio'

interface ClockState { alarmTimeMinutes?: number }

const DEFAULT_CLOCK_STATE_FILE_PATH = '/run/sunrise-clock-state.json'
const DEFAULT_SHOW_ALARM_DELAY_MS = 2 * 1000
const DEFAULT_ALARM_BUTTON_PIN = 10
const DEFAULT_ALARM_LED_PIN = 24
const DEFAULT_ROTARY_CW_PIN = 14
const DEFAULT_ROTARY_CCW_PIN = 15
const DEFAULT_ROTARY_BUTTON_PIN = 18
const DEFAULT_ROTARY_SPEED = 1 / 3
const DEFAULT_ALARM_MINUTES = 10 * 60
const DEFAULT_RED_PIN = 27
const DEFAULT_GREEN_PIN = 17
const DEFAULT_BLUE_PIN = 22
const DEFAULT_WHITE_PIN = 23
const DEFAULT_ENCODER_MODE = 'MINUTES'

const BUTTON_DEBOUNCE_NS = 100 * 1000
const DAY_MINUTES = 60 * 24

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
    private readonly alarmButton: Gpio
    private readonly alarmLed: Gpio

    private editMode: null | 'MINUTES' | 'HOURS' = null
    private editOffset: number = 0
    private alarmTimeMinutes: number = DEFAULT_ALARM_MINUTES
    private showTimeTimeout: Timeout | null = null

    constructor({
        clockStateFilePath = DEFAULT_CLOCK_STATE_FILE_PATH,
        showAlarmDelayMs= DEFAULT_SHOW_ALARM_DELAY_MS,
        alarmButtonPin = DEFAULT_ALARM_BUTTON_PIN,
        alarmLedPin = DEFAULT_ALARM_LED_PIN,
        displayAddress,
        i2cBus,
        rotaryCwPin = DEFAULT_ROTARY_CW_PIN,
        rotaryCcwPin = DEFAULT_ROTARY_CCW_PIN,
        rotaryButtonPin = DEFAULT_ROTARY_BUTTON_PIN,
        rotarySpeed = DEFAULT_ROTARY_SPEED,
        redPin = DEFAULT_RED_PIN,
        greenPin = DEFAULT_GREEN_PIN,
        bluePin = DEFAULT_BLUE_PIN,
        whitePin = DEFAULT_WHITE_PIN,
    }: {
        clockStateFilePath?: string
        showAlarmDelayMs?: number
        alarmButtonPin?: number
        alarmLedPin?: number
        displayAddress?: number
        i2cBus?: number
        rotaryCwPin?: number
        rotaryCcwPin?: number
        rotaryButtonPin?: number
        rotarySpeed?: number
        redPin?: number | null
        greenPin?: number | null
        bluePin?: number | null
        whitePin?: number | null
    } = {}) {
        this.clockStateFilePath = clockStateFilePath
        this.showAlarmDelayMs = showAlarmDelayMs

        this.alarmButton = new Gpio(alarmButtonPin, {
            mode: Gpio.INPUT,
            pullUpDown: Gpio.PUD_UP,
            alert: true,
        })
        this.alarmButton.glitchFilter(BUTTON_DEBOUNCE_NS)
        this.alarmButton.on('alert', () => this.checkActive())

        this.alarmLed = new Gpio(alarmLedPin, { mode: Gpio.OUTPUT })
        this.alarmLed.pwmFrequency(PWM_FREQUENCY)
        this.alarmLed.pwmRange(PWM_RANGE)

        this.display = new Display({ displayAddress, i2cBus })

        const encoder = new RotaryEncoder(rotaryCwPin, rotaryCcwPin, rotaryButtonPin)
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
                this.alarmTimeMinutes = lastAlarmTimeMinutes + Math.round(this.editOffset)
            } else {
                this.alarmTimeMinutes = lastAlarmTimeMinutes + Math.round(this.editOffset) * 60
            }

            if (this.alarmTimeMinutes < 0) this.alarmTimeMinutes += DAY_MINUTES
            else if (this.alarmTimeMinutes >= DAY_MINUTES) this.alarmTimeMinutes %= DAY_MINUTES

            this.updateAlarmTime()
            this.saveClockState()
        })
        this.loadClockState()

        this.sunrise = new Sunrise({
            redPin, greenPin, bluePin, whitePin,
            pwmFrequency: PWM_FREQUENCY, pwmRange: PWM_RANGE
        })

        this.checkActive()
        this.run()
    }

    public stop(): void {
        this.sunrise.stop()
        this.display.clear()
        this.alarmLed.pwmWrite(0)
    }

    private checkActive(): void {
        const active = 1 - this.alarmButton.digitalRead()
        this.alarmLed.pwmWrite(active * PWM_RANGE)
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
                    console.error(`Error parsing state file ${this.clockStateFilePath}:`, err)
                }
            }
        })
    }

    @debounce(5 * 1000, 60 * 1000)
    private saveClockState(): void {
        const clockState: ClockState = { alarmTimeMinutes: this.alarmTimeMinutes }
        fs.writeFile(this.clockStateFilePath, JSON.stringify(clockState), (err) => {
            if (err) {
                console.error(`Error saving clock state file ${this.clockStateFilePath}:`, err)
            } else {
                console.log(`Successfully saved clock state!`)
            }
        })
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
        this.display.setTime(this.alarmTimeMinutes, this.editMode === 'HOURS', false, this.editMode === 'MINUTES')

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