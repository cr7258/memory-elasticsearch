declare const plugin: {
    id: string;
    name: string;
    description: string;
    register(api: any): void;
};

export { plugin as default };
