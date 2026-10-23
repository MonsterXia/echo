declare function className(
    ...names: Array<
        | string
        | number
        | boolean
        | null
        | undefined
        | { [key: string]: any }
        | Array<any>
    >
): string;

export = className;
