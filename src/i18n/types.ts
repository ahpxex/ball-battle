/**
 * Shape a translation must match, derived from the Chinese source locale:
 * the same keys and array lengths, with any string as the value.
 */
export type LocaleShape<T> = T extends string ? string : { readonly [K in keyof T]: LocaleShape<T[K]> }
