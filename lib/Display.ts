// @ts-ignore
import SsDisplay from 'ht16k33-sevensegment-display'

const DEFAULT_DISPLAY_ADDRESS = 0x70
const DEFAULT_I2C_BUS = 1
const BRIGHTNESS_MAX = 15

export class Display {
    private readonly use24Time: boolean
    private readonly display: SsDisplay

    private minutesSinceMidnight = 0
    private firstDot = false
    private secondDot = false
    private thirdDot = false

    constructor({
        use24Time = false,
        displayAddress = DEFAULT_DISPLAY_ADDRESS,
        i2cBus= DEFAULT_I2C_BUS
    }: {
        use24Time?: boolean
        displayAddress?: number
        i2cBus?: number
    } = {}) {
        this.use24Time = use24Time
        this.display = new SsDisplay(displayAddress, i2cBus)
        this.setBrightness(1)
        this.display.clear()
        this.display.setColon(true)

        setInterval(this.paint.bind(this), 0)
        this.paint()
    }

    public setTime(minutesSinceMidnight: number, firstDot = false, secondDot = false, thirdDot = false) {
        this.minutesSinceMidnight = minutesSinceMidnight
        this.firstDot = firstDot
        this.secondDot = secondDot
        this.thirdDot = thirdDot
    }

    public setBrightness(zeroToOne: number) {
        this.display.display.setBrightness(zeroToOne * BRIGHTNESS_MAX)
    }

    private paint(): void {
        let hours = Math.floor(this.minutesSinceMidnight / 60)
        let pmDot = false
        if (!this.use24Time) {
            if (hours === 0) {
                hours = 12
            } else if (hours >= 12) {
                pmDot = true
                if (hours > 12) {
                    hours -= 12
                }
            }
        }
        const minutes = Math.floor(this.minutesSinceMidnight % 60)

        this.display.writeDigit(0, hours >= 10 ? Math.floor(hours / 10) : null, this.firstDot)
        this.display.writeDigit(1, hours % 10, this.secondDot)
        this.display.writeDigit(3, Math.floor(minutes / 10), this.thirdDot)
        this.display.writeDigit(4, minutes % 10, pmDot)
    }
}