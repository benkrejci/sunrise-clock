import _ from 'lodash'

import { Display } from './Display'
import { LightController, Rgbw } from './LightController'
import { RotaryEncoder } from './RotaryEncoder'

const DEFAULT_ROTARY_CW_PIN = 14
const DEFAULT_ROTARY_CCW_PIN = 15
const DEFAULT_ROTARY_BUTTON_PIN = 18
const DEFAULT_ROTARY_SPEED = 1 / 3

export class Test {
    private readonly display: Display
    private readonly lightController: LightController

    private rgbw: Rgbw = [120, 30, 0, 0]
    private editColor: number = 1

    constructor({
        i2cBus,
        displayAddress,
        lightControllerAddress,
        rotaryCwPin = DEFAULT_ROTARY_CW_PIN,
        rotaryCcwPin = DEFAULT_ROTARY_CCW_PIN,
        rotaryButtonPin = DEFAULT_ROTARY_BUTTON_PIN,
        rotarySpeed = DEFAULT_ROTARY_SPEED,
    }: {
        i2cBus?: number
        displayAddress?: number
        lightControllerAddress?: number
        rotaryCwPin?: number
        rotaryCcwPin?: number
        rotaryButtonPin?: number
        rotarySpeed?: number
    } = {}) {
        this.display = new Display({ i2cBus, i2cAddress: displayAddress })

        this.lightController = new LightController({
            i2cBus,
            i2cAddress: lightControllerAddress,
        })

        const encoder = new RotaryEncoder(
            rotaryCwPin,
            rotaryCcwPin,
            rotaryButtonPin,
        )

        this.lightController.ready(() => {
            this.updateRgbw()
            encoder.on('rotate', (delta) => {
                this.rgbw[this.editColor] = _.clamp(
                    this.rgbw[this.editColor] + delta * rotarySpeed,
                    0,
                    255,
                )
                console.log(this.rgbw)
                this.updateRgbw()
            })
            encoder.on('release', () => {
                this.editColor =
                    this.editColor >= this.rgbw.length - 1
                        ? 0
                        : this.editColor + 1
            })
        })
    }

    public stop(): void {
        this.lightController?.stop()
        this.display.clear()
    }

    private updateRgbw() {
        this.lightController.setRgbw(this.rgbw)
        this.display.setTime(this.rgbw[this.editColor])
    }
}
