import { OriginChecker, RateLimiter, RateLimiterConfig } from "./accessControl.ts";
import type { JSONResponse } from "./api.ts";
import type { ServiceConsole } from "./console.ts";

export interface Context {
	console: ServiceConsole;
	requestIP: string;
	requestID: string | null;
};

export interface RouteConfig {
	expand?: boolean;
	url?: string;
	ratelimit?: RateLimiterConfig | false;
	allowedOrigings?: string[] | false;
};

export type RouteResponse = JSONResponse<object> | Response;
export type RouteHandler = (request: Request, context: Context) => Promise<RouteResponse> | RouteResponse;

export interface StaticHandler {
	handler: RouteHandler;
	config?: Omit<RouteConfig, 'url'>;
};

export interface RouteCtx {
	expandPath: boolean;
	rateLimiter?: RateLimiter | null;
	originChecker?: OriginChecker | null;
	handler: RouteHandler;
};

export const applyConfig = (config: RouteConfig): Partial<RouteCtx> => ({
	rateLimiter: config.ratelimit === false ? null : (Object.keys(config.ratelimit || {}).length ? new RateLimiter(config.ratelimit) : undefined),
	originChecker: config.allowedOrigings === false ? null :(config.allowedOrigings?.length ? new OriginChecker(config.allowedOrigings) : undefined)
});

type HandlersPool = Record<string, RouteCtx>;

export const loadFunctionsFromFS = async (fromDir: string): Promise<HandlersPool> => {

	const entries: string[] = [];

	const iterateDirectory = async (dir: string) => {
		const nextEntries = Deno.readDir(dir);
		for await (const item of nextEntries) {
			const itemPath = `${dir}/${item.name}`;
			if (item.isDirectory) {
				await iterateDirectory(itemPath);
			} else if (item.isFile) {
				entries.push(itemPath);
			}
		}
	};
	await iterateDirectory(fromDir);

	if (!entries.length) throw new Error(`Failed to load route functions: no modules found in "${fromDir}"`);

	const result: Record<string, RouteCtx> = {};

	for (const entry of entries) {

		try {

			const importPath = /^([A-z]\:)?[\\\/]/.test(entry) ? entry : `${Deno.cwd()}/${entry}`;
			const importURL = `file:///` + importPath.replace(/[\\\/]+/g, '/').replace(/\/[^\/]+\/[\.]{2}\//g, '/').replace(/\/\.\//g, '/');

			console.log(`%c --> Loading function %c${entry}\n\t (resolved: ${importURL})`, 'color: blue', 'color: white');

			const imported = await import(importURL);	
	
			const handler = (imported['default'] || imported['handler']);
			if (!handler || typeof handler !== 'function') throw new Error('No handler exported');
	
			const config = (imported['config'] || {}) as RouteConfig;
			if (typeof config !== 'object') throw new Error('Config invalid');

			const pathNoExt = entry.slice(fromDir.length, entry.lastIndexOf('.'));
			const indexIndex = pathNoExt.lastIndexOf('/index');
			const fsRoutedUrl = indexIndex === -1 ? pathNoExt : (indexIndex === 0 ? '/' : pathNoExt.slice(0, indexIndex));
			const customUrl = config.url?.replace(/[\/\*]+$/, '');

			const pathname = typeof customUrl === 'string' ? customUrl : fsRoutedUrl;
			if (!pathname.startsWith('/')) throw new Error(`Invalid route url: ${pathname}`);

			const expandPathByUrl = config.url?.endsWith('/*');
			const expandFlagProvided = typeof config.expand === 'boolean';
			if (expandPathByUrl && expandFlagProvided) {
				console.warn(`Module %c"${entry}"%c has both expanding path and %cconfig.expand%c set, the last will be used`, 'color: yellow', 'color: inherit', 'color: yellow', 'color: inherit');
			}

			result[pathname] = Object.assign({
				handler,
				expandPath: expandFlagProvided ? (config.expand as boolean) : (expandPathByUrl || false)
			}, applyConfig(config));

		} catch (error) {
			throw new Error(`Failed to import route module ${entry}: ${(error as Error).message}`);
		}
	}

	console.log(`%cLoaded ${entries.length} functions`, 'color: green')

	return result;
};

export const transformProvidedFunctions = async (functions: Record<string, StaticHandler>): Promise<HandlersPool> => {
	return Object.fromEntries(Object.entries(functions).map(([key, value]) => {
		return [key, Object.assign({
			handler: value.handler,
			expandPath: key.endsWith('/*')
		}, applyConfig(value.config || {}))]
	}));
};
