import { debounce as _debounce } from './debounce'

export function debounce<T>(
    minDelay?: number,
    maxDelay?: number,
): (
    target: T,
    propertyKey: string,
    descriptor: PropertyDescriptor,
) => PropertyDescriptor | void {
    return (target: T, propertyKey: string, descriptor: PropertyDescriptor) => {
        descriptor.value = _debounce(descriptor.value, minDelay, maxDelay)
    }
}
