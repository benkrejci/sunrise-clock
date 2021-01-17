import { TypedEmitter } from 'tiny-typed-emitter'

import { debounce } from './decorators'
import { linearColor, Rgbw, RGBW_BRIGHT, RGBW_OFF } from './Light'

import Timeout = NodeJS.Timeout

type Minutes = number

interface SunriseEvents {
    update: (rgbw: Rgbw) => void
}

interface RgbwKeyframe {
    duration: Minutes
    rgbw: Rgbw
    sunUp?: boolean // true if this frame corresponds to sun up time (t=0)
}

const RGBW_KEYFRAMES: RgbwKeyframe[] = [
    { duration: 5, rgbw: [0, 0, 0, 0] }, // off
    { duration: 5, rgbw: [60, 0, 5, 0] }, // purple
    { duration: 10, rgbw: [210, 0, 0, 0] }, // red
    { duration: 10, rgbw: [200, 70, 0, 20] }, // orange
    {
        duration: 30,
        rgbw: RGBW_BRIGHT, // white
        sunUp: true,
    },
    { duration: 30, rgbw: RGBW_BRIGHT }, // fade out
]

const PAINT_DEBOUNCE_MIN_DELAY_MS = 10
const PAINT_DEBOUNCE_MAX_DELAY_MS = 80

export class Sunrise extends TypedEmitter<SunriseEvents> {
    private readonly rgbwKeyframes: RgbwKeyframe[]

    private active = true
    private sunUpMinutes: Minutes = 0
    private sunriseDurationMinutes: Minutes = 0
    private sunSetDurationMinutes: Minutes = 0
    private runTimeout: Timeout | null = null
    private rgbw: Rgbw = RGBW_OFF

    constructor({
        rgbwKeyframes = RGBW_KEYFRAMES,
    }: {
        rgbwKeyframes?: RgbwKeyframe[]
    }) {
        super()

        this.rgbwKeyframes = rgbwKeyframes

        // calculate duration of sunrise until sunUp time so we know when to start
        let rising = true
        rgbwKeyframes?.forEach((frame) => {
            if (frame.sunUp) rising = false
            if (rising) this.sunriseDurationMinutes += frame.duration
            else this.sunSetDurationMinutes += frame.duration
        })

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

    public getRgbw(): Rgbw {
        return this.rgbw
    }

    private setRgbw(rgbw: Rgbw): void {
        if (rgbw.every((value, index) => value === this.rgbw[index])) return
        this.rgbw = rgbw
        this.emit('update', rgbw)
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

        const now = new Date()
        const nowMinutes: Minutes =
            now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60
        let start: Minutes = this.sunUpMinutes - this.sunriseDurationMinutes
        const end: Minutes = this.sunUpMinutes + this.sunSetDurationMinutes
        if (start > nowMinutes) start -= 24 * 60
        else if (end < nowMinutes) start += 24 * 60
        const t: Minutes = nowMinutes - start

        this.setRgbw(this.calcRgbw(t))
    }

    private calcRgbw(t: Minutes): Rgbw {
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
                    return linearColor(
                        t,
                        0,
                        frame.duration,
                        frame.rgbw,
                        nextFrame?.rgbw || firstFrame.rgbw,
                    )
                }
                t -= frame.duration
            }
        }
    }
}
