import { Gpio } from 'pigpio'
import { debounce } from './decorators'
import Timeout = NodeJS.Timeout

enum ColorChannel { R, G, B, W }
type Rgbw<V = number> = [V, V, V, V]
type Minutes = number

const RGBW_OFF: Rgbw = [0, 0, 0, 0]

interface RgbwKeyframe {
    duration: Minutes
    rgbw: Rgbw
    sunUp?: boolean // true if this frame corresponds to sun up time (t=0)
}

const RGBW_KEYFRAMES: RgbwKeyframe[] = [
    { duration: 5 , rgbw: [0  , 0  , 0  , 0  ] }, // off
    { duration: 5 , rgbw: [100, 0  , 20 , 0  ] }, // purple
    { duration: 10, rgbw: [127, 0  , 0  , 10  ] }, // red
    { duration: 10, rgbw: [190, 120, 0  , 20  ] }, // orange
    { duration: 60, rgbw: [255, 255, 60 , 255],   // white
      sunUp: true },
    { duration: 60, rgbw: [255, 255, 160, 255] }, // fade out
]

const PAINT_DEBOUNCE_MIN_DELAY_MS = 10
const PAINT_DEBOUNCE_MAX_DELAY_MS = 80

export class Sunrise {
    private readonly rgbwKeyframes: RgbwKeyframe[]
    private readonly gpioByColor: Rgbw<Gpio | null> = [null, null, null, null]
    private readonly pwmFrequency: number
    private readonly pwmRange: number

    private active = true
    private sunUpMinutes: Minutes = 0
    private sunriseDurationMinutes: Minutes = 0
    private sunSetDurationMinutes: Minutes = 0
    private runTimeout: Timeout | null = null

    constructor({
        redPin,
        greenPin,
        bluePin,
        whitePin,
        rgbwKeyframes = RGBW_KEYFRAMES,
        pwmFrequency,
        pwmRange,
    }: {
        redPin: number | null
        greenPin: number | null
        bluePin: number | null
        whitePin: number | null
        rgbwKeyframes?: RgbwKeyframe[]
        pwmFrequency: number
        pwmRange: number
    }) {
        this.rgbwKeyframes = rgbwKeyframes

        // calculate duration of sunrise until sunUp time so we know when to start
        let rising = true
        rgbwKeyframes?.forEach((frame) => {
            if (frame.sunUp) rising = false
            if (rising) this.sunriseDurationMinutes += frame.duration
            else this.sunSetDurationMinutes += frame.duration
        })

        this.pwmFrequency = pwmFrequency
        this.pwmRange = pwmRange

        this.initColor(ColorChannel.R, redPin)
        this.initColor(ColorChannel.G, greenPin)
        this.initColor(ColorChannel.B, bluePin)
        this.initColor(ColorChannel.W, whitePin)

        this.run()
    }

    public stop() {
        if (this.runTimeout !== null) clearTimeout(this.runTimeout)
        this.setRgbw(RGBW_OFF)
    }

    public setActive(active: boolean) {
        this.active = active
        this.paint()
    }

    public setSunUpTime(sunUpMinutes: Minutes) {
        this.sunUpMinutes = sunUpMinutes
        this.paint()
    }

    private initColor(colorIndex: ColorChannel, gpioPin: number | null): void {
        if (gpioPin === null) return
        const output = this.gpioByColor[colorIndex] = new Gpio(gpioPin, { mode: Gpio.OUTPUT })
        output.pwmFrequency(this.pwmFrequency)
        output.pwmRange(this.pwmRange)
    }

    private run(): void {
        this.paint()

        // update at top of the second
        const now = new Date()
        this.runTimeout = setTimeout(() => {
            this.run()
        }, 1000 - now.getMilliseconds())
    }

    @debounce(PAINT_DEBOUNCE_MIN_DELAY_MS, PAINT_DEBOUNCE_MAX_DELAY_MS)
    private paint(): void {
        if (!this.active) {
            this.setRgbw(RGBW_OFF)
            return
        }

        const start: Minutes = this.sunUpMinutes - this.sunriseDurationMinutes
        const now = new Date()
        let nowMinutes: Minutes = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
        if (nowMinutes > this.sunUpMinutes + this.sunSetDurationMinutes) nowMinutes -= 24 * 60
        const t: Minutes = nowMinutes - start

        this.setRgbw(gamma(this.getRgbw(t)))
    }

    private getRgbw(t: Minutes): Rgbw {
        const firstFrame = this.rgbwKeyframes[0]
        if (t < 0) {
            return firstFrame.rgbw
        } else {
            let frameIndex = 0
            while (true) {
                const frame: RgbwKeyframe = this.rgbwKeyframes[frameIndex++]
                const nextFrame: RgbwKeyframe = this.rgbwKeyframes[frameIndex]

                if (!frame) return this.rgbwKeyframes[0].rgbw
                if (t < frame.duration) {
                    return linearColor(t, 0, frame.duration, frame.rgbw, nextFrame?.rgbw || firstFrame.rgbw)
                }
                t -= frame.duration
            }
        }
    }

    private setRgbw(rgbw: Rgbw): void {
        this.gpioByColor.forEach((gpio, colorIndex) => {
            if (!gpio) return
            gpio.pwmWrite(Math.round(rgbw[colorIndex] / 255 * this.pwmRange))
        })
    }
}

const linear = (x: number, xStart: number, xEnd: number, yStart: number, yEnd: number): number =>
    ( x - xStart ) / ( xEnd - xStart ) * ( yEnd - yStart ) + yStart
const linearColor = (x: number, xStart: number, xEnd: number, rgbwStart: Rgbw, rgbwEnd: Rgbw): Rgbw =>
    <Rgbw>rgbwStart.map((value, colorIndex) => linear(x, xStart, xEnd, value, rgbwEnd[colorIndex]))
const gamma = (rgbw: Rgbw): Rgbw => <Rgbw>rgbw.map(value => Math.pow(value / 255, 2.2) * 255)