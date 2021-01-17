import { Gpio } from 'pigpio'

export enum ColorChannel {
    R,
    G,
    B,
    W,
}
export type Rgbw<V = number> = [V, V, V, V]

export const RGBW_OFF: Rgbw = [0, 0, 0, 0]
export const RGBW_BRIGHT: Rgbw = [200, 140, 60, 255]

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

export class Light {
    private readonly pwmFrequency: number
    private readonly pwmRange: number
    private readonly gpioByColor: Rgbw<Gpio | null> = [null, null, null, null]

    constructor({
        redPin,
        greenPin,
        bluePin,
        whitePin,
        pwmFrequency,
        pwmRange,
    }: {
        redPin: number | null
        greenPin: number | null
        bluePin: number | null
        whitePin: number | null
        pwmFrequency: number
        pwmRange: number
    }) {
        this.pwmFrequency = pwmFrequency
        this.pwmRange = pwmRange

        this.initColor(ColorChannel.R, redPin)
        this.initColor(ColorChannel.G, greenPin)
        this.initColor(ColorChannel.B, bluePin)
        this.initColor(ColorChannel.W, whitePin)
    }

    public setRgbw(rgbw: Rgbw): void {
        this.gpioByColor.forEach((gpio, colorIndex) => {
            if (!gpio) return
            gpio.pwmWrite(
                Math.round(gammaPow(rgbw[colorIndex] / 255) * this.pwmRange),
            )
        })
    }

    private initColor(colorIndex: ColorChannel, gpioPin: number | null): void {
        if (gpioPin === null) return
        const output = (this.gpioByColor[colorIndex] = new Gpio(gpioPin, {
            mode: Gpio.OUTPUT,
        }))
        output.pwmFrequency(this.pwmFrequency)
        output.pwmRange(this.pwmRange)
    }
}

const gammaPow = (zeroToOne: number): number => Math.pow(zeroToOne, 2.2)
