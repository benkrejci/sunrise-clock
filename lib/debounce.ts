import Timeout = NodeJS.Timeout

export function debounce(
    callback: Function,
    minDelay: number = 0,
    maxDelay: number | null = null,
): Function {
    let callTimeout: Timeout | null = null
    const handler = function (this: any, args: any[]) {
        callback.apply(this, args)
        callTimeout = null
    }
    if (maxDelay === null) {
        return function (this: any, ...args: any[]) {
            if (callTimeout !== null) clearTimeout(callTimeout)
            callTimeout = setTimeout(handler.bind(this, args), minDelay)
        }
    }

    let latestCallTime: number | null = null
    return function (this: any, ...args: any[]) {
        const now = +new Date()
        let delay: number
        if (callTimeout === null || latestCallTime === null) {
            delay = minDelay
            latestCallTime = now + maxDelay
        } else {
            clearTimeout(callTimeout)
            if (now >= latestCallTime) {
                return handler.call(this, args)
            } else {
                delay = Math.min(minDelay, latestCallTime)
            }
        }
        callTimeout = setTimeout(handler.bind(this, args), delay)
    }
}
