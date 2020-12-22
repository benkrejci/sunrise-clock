import { Gpio } from 'pigpio'
import { debounce } from './decorators'

enum COLOR_INDEX { R, G, B, W }
type Rgbw<V = number> = [V, V, V, V]
type Minutes = number
interface RgbwKeyframe {
    duration: Minutes
    rgbw: Rgbw
}

const RGBW_KEYFRAMES: RgbwKeyframe[] = [
    { duration: 5 , rgbw: [0  , 0  , 0  , 0  ] }, // off
    { duration: 5 , rgbw: [200, 0  , 127, 0  ] }, // purple
    { duration: 10, rgbw: [255, 0  , 0  , 0  ] }, // red
    { duration: 10, rgbw: [255, 200, 0  , 0  ] }, // yellow
    { duration: 60, rgbw: [255, 255, 160, 255] }, // white
    { duration: 60, rgbw: [255, 255, 160, 255] },
]

export class Sunrise {
    private rgbwKeyframes: RgbwKeyframe[]
    private readonly gpioByColor: Rgbw<Gpio | null> = [null, null, null, null]

    private sunUpMinutes: Minutes = 0
    private sunriseDurationMinutes: Minutes

    constructor({
        redPin,
        greenPin,
        bluePin,
        whitePin,
        rgbwKeyframes = RGBW_KEYFRAMES,
    }: {
        redPin: number | null
        greenPin: number | null
        bluePin: number | null
        whitePin: number | null
        rgbwKeyframes?: RgbwKeyframe[]
    }) {
        this.rgbwKeyframes = rgbwKeyframes
        this.sunriseDurationMinutes = rgbwKeyframes?.reduce((previous: number, frame: RgbwKeyframe) => previous + frame.duration, 0)

        this.initColor(COLOR_INDEX.R, redPin)
        this.initColor(COLOR_INDEX.G, greenPin)
        this.initColor(COLOR_INDEX.B, bluePin)
        this.initColor(COLOR_INDEX.W, whitePin)

        this.run()
    }

    public setSunUpTime(sunUpMinutes: Minutes) {
        this.sunUpMinutes = sunUpMinutes
        this.paint()
    }

    private initColor(colorIndex: COLOR_INDEX, gpioPin: number | null): void {
        if (gpioPin === null) return
        this.gpioByColor[colorIndex] = new Gpio(gpioPin, { mode: Gpio.OUTPUT })
    }

    private run(): void {
        this.paint()

        // update at top of the second
        const now = new Date()
        setTimeout(() => {
            this.run()
        }, 1000 - now.getMilliseconds())
    }

    @debounce(20, 100)
    private paint(): void {
        const start: Minutes = this.sunUpMinutes - this.sunriseDurationMinutes
        const now = new Date()
        let nowMinutes: Minutes = now.getHours() * 60 + now.getMinutes()
        if (nowMinutes > this.sunUpMinutes) nowMinutes -= 24 * 60
        const t: Minutes = nowMinutes - start

        this.setRgbw(roundRgbw(gamma(this.getRgbw(t))))
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
                    // console.log(`linearColor(${t}, 0, ${frame.duration}, [${frame.rgbw}], [${frame.rgbw}])`)
                    return linearColor(t, 0, frame.duration, frame.rgbw, nextFrame?.rgbw || firstFrame.rgbw)
                }
                t -= frame.duration
            }
        }
    }

    private setRgbw(rgbw: Rgbw): void {
        this.gpioByColor.forEach((gpio, colorIndex) => {
            if (!gpio) return
            gpio.pwmWrite(rgbw[colorIndex])
        })
    }
}

const linear = (x: number, xStart: number, xEnd: number, yStart: number, yEnd: number): number =>
    ( x - xStart ) / ( xEnd - xStart ) * ( yEnd - yStart ) + yStart
const linearColor = (x: number, xStart: number, xEnd: number, rgbwStart: Rgbw, rgbwEnd: Rgbw): Rgbw =>
    <Rgbw>rgbwStart.map((value, colorIndex) => linear(x, xStart, xEnd, value, rgbwEnd[colorIndex]))
const gamma = (rgbw: Rgbw): Rgbw => <Rgbw>rgbw.map(value => Math.pow(value / 255, 2.2) * 255)
const roundRgbw = (rgbw: Rgbw): Rgbw => <Rgbw>rgbw.map(value => Math.round(value))