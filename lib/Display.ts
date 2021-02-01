import { SevenSegment } from './SevenSegment'

const DEFAULT_I2C_ADDRESS = 0x70
const DEFAULT_I2C_BUS = 1

const BRIGHTNESS_MAX = 15

export class Display {
    private readonly use24Time: boolean
    private readonly display: SevenSegment

    private minutesSinceMidnight = 0
    private firstDot = false
    private secondDot = false
    private thirdDot = false

    constructor({
        use24Time = false,
        i2cBus = DEFAULT_I2C_BUS,
        i2cAddress = DEFAULT_I2C_ADDRESS,
    }: {
        use24Time?: boolean
        i2cAddress?: number
        i2cBus?: number
    } = {}) {
        this.use24Time = use24Time
        this.display = new SevenSegment(i2cBus, i2cAddress, () => {
            this.display.clear()
            this.display.setColon(true)

            this.paint()
        })
    }

    public clear(): void {
        this.display.clear()
        this.display.flush()
    }

    public setTime(
        minutesSinceMidnight: number,
        firstDot = false,
        secondDot = false,
        thirdDot = false,
    ): void {
        this.minutesSinceMidnight = minutesSinceMidnight
        this.firstDot = firstDot
        this.secondDot = secondDot
        this.thirdDot = thirdDot

        this.paint()
    }

    public setBrightness(zeroToOne: number): void {
        this.display.setBrightness(Math.round(zeroToOne * BRIGHTNESS_MAX))
        this.display.flush()
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

        this.display.writeDigit(
            0,
            hours >= 10 ? Math.floor(hours / 10) : null,
            this.firstDot,
        )
        this.display.writeDigit(1, hours % 10, this.secondDot)
        this.display.writeDigit(3, Math.floor(minutes / 10), this.thirdDot)
        this.display.writeDigit(4, minutes % 10, pmDot)

        this.display.flush()
    }
}
