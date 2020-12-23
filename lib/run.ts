import { Clock } from './Clock'

const clock = new Clock()

function exit() {
    clock.stop()
    process.exit(0)
}

process.on('SIGTERM', () => {
    process.stdout.write('SIGTERM signal received\n')
    exit()
})

process.on('SIGINT',  () => {
    process.stdout.write('SIGINT signal received\n')
    exit()
})
