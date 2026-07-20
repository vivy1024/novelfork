interface ImportMetaEnv {
	readonly DEV: boolean;
}

interface ImportMeta {
	readonly env: ImportMetaEnv;
}

declare module "lang-map" {
	const map: {
		languages(extension: string): readonly string[] | undefined;
	};

	export default map;
}
