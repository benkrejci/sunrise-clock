import fs from 'fs'
import { RotaryEncoder } from './RotaryEncoder'
import { Display } from './Display'
import { Sunrise } from './Sunrise'
import Timeout = NodeJS.Timeout
import { debounce } from './decorators'

interface ClockState { alarmTimeMinutes?: number }

const DEFAULT_CLOCK_STATE_FILE_PATH = '/run/sunrise-clock-state.json'
const DEFAULT_SHOW_ALARM_DELAY_MS = 1000
const DEFAULT_ROTARY_CW_PIN = 14
const DEFAULT_ROTARY_CCW_PIN = 15
const DEFAULT_ROTARY_BUTTON_PIN = 18
const DEFAULT_ROTARY_SPEED = 1 / 3
const DEFAULT_ALARM_MINUTES = 10 * 60
const DEFAULT_RED_PIN = 17
const DEFAULT_GREEN_PIN = 4
const DEFAULT_BLUE_PIN = 27
const DEFAULT_WHITE_PIN = 22

const DAY_MINUTES = 60 * 24

export class Clock {
    private readonly clockStateFilePath: string
    private readonly showAlarmDelayMs: number
    private readonly display: Display
    private readonly sunrise: Sunrise

    private alarmTimeMinutes: number = DEFAULT_ALARM_MINUTES
    private showTimeTimeout: Timeout | null = null

    constructor({
        clockStateFilePath = DEFAULT_CLOCK_STATE_FILE_PATH,
        showAlarmDelayMs= DEFAULT_SHOW_ALARM_DELAY_MS,
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

        this.display = new Display({ displayAddress, i2cBus })

        const encoder = new RotaryEncoder(rotaryCwPin, rotaryCcwPin, rotaryButtonPin)
        encoder.on('rotate', (delta) => {
            this.alarmTimeMinutes += delta * rotarySpeed
            if (this.alarmTimeMinutes < 0) this.alarmTimeMinutes += DAY_MINUTES
            else if (this.alarmTimeMinutes >= DAY_MINUTES) this.alarmTimeMinutes -= DAY_MINUTES

            this.updateAlarmTime()
            this.saveClockState()
        })
        this.loadClockState()

        this.sunrise = new Sunrise({ redPin, greenPin, bluePin, whitePin })

        this.run()
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
        this.display.setTime(this.alarmTimeMinutes)

        // clear the current timeout to show the time
        if (this.showTimeTimeout !== null) clearTimeout(this.showTimeTimeout)
        this.showTimeTimeout = null

        // set a timeout to resume showing the time
        this.showTimeTimeout = setTimeout(() => {
            this.showTimeTimeout = null
            this.run()
        }, this.showAlarmDelayMs)
    }
}