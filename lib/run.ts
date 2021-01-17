import { Clock } from './Clock'

// wait a little to make sure async i2c commands go out (e.g. to clear the display)
const STOP_DELAY_MS = 200

const clock = new Clock({})

function exit() {
    clock.stop()
    setTimeout(() => {
        process.exit(0)
    }, STOP_DELAY_MS)
}

process.on('SIGTERM', () => {
    process.stdout.write('SIGTERM signal received\n')
    exit()
})

process.on('SIGINT', () => {
    process.stdout.write('SIGINT signal received\n')
    exit()
})
