import { TypedEmitter } from 'tiny-typed-emitter'
import { Gpio } from 'pigpio'

export interface RotaryEncoderEvents {
    rotate: (delta: number) => void,
    press: () => void,
    release: () => void,
}

const DEFAULT_PULL = 'UP'
const DEFAULT_DEBOUNCE_DELAY_NS = 500

export class RotaryEncoder extends TypedEmitter<RotaryEncoderEvents> {
    private cwState: 0 | 1 = 0
    private ccwState: 0 | 1 = 0
    private state: number = 0 // binary where LSB is ccw state and MSB is cw state

    constructor(cwPin: number, ccwPin: number, buttonPin: number, {
        pull = DEFAULT_PULL,
        debounceDelayNs = DEFAULT_DEBOUNCE_DELAY_NS
    }: {
        pull?: 'UP' | 'DOWN',
        debounceDelayNs?: number
    } = {}) {
        super()

        const onLevel = pull === 'UP' ? 0 : 1

        const cwInput = new Gpio(cwPin, {
            mode: Gpio.INPUT,
            pullUpDown: pull === 'UP' ? Gpio.PUD_UP : Gpio.PUD_DOWN,
            alert: true,
        })
        if (debounceDelayNs) cwInput.glitchFilter(debounceDelayNs)
        cwInput.on('alert', (value) => {
            this.cwState = value === onLevel ? 1 : 0
            this.update()
        })

        const ccwInput = new Gpio(ccwPin, {
            mode: Gpio.INPUT,
            pullUpDown: pull === 'UP' ? Gpio.PUD_UP : Gpio.PUD_DOWN,
            alert: true,
        })
        if (debounceDelayNs) ccwInput.glitchFilter(debounceDelayNs)
        ccwInput.on('alert', (value) => {
            this.ccwState = value === onLevel ? 1 : 0
            this.update()
        })

        const buttonInput = new Gpio(buttonPin, {
            mode: Gpio.INPUT,
            pullUpDown: pull === 'UP' ? Gpio.PUD_UP : Gpio.PUD_DOWN,
            alert: true,
        })
        if (debounceDelayNs) buttonInput.glitchFilter(debounceDelayNs)
        buttonInput.on('alert', (value: number) => {
            this.emit(value === onLevel ? 'press' : 'release')
        })
    }

    private update(): void {
        const state = (this.cwState << 1) | this.ccwState
        if (state === this.state) return

        const transition = (this.state << 2 ) | state
        this.state = state

        const delta = this.getDeltaFromTransitionState(transition)

        if (delta !== 0) this.emit('rotate', delta)
    }

    private getDeltaFromTransitionState(transition: number): number {
        if (transition === 0b0010 || transition === 0b0100 || transition === 0b1011 || transition === 0b1101) {
            return 1
        } else if (transition === 0b0001 || transition === 0b0111 || transition === 0b1000 || transition === 1110) {
            return -1
        } else {
            return 0
        }
    }
}