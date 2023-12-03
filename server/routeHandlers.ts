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
	path: string;
	config?: Omit<RouteConfig, 'url'>;
};

export interface RouteCtx {
	url: {
		pathname: string;
		expand: boolean;
	};
	rateLimiter?: RateLimiter | null;
	originChecker?: OriginChecker | null;
	handler: RouteHandler;
};

interface RouteSearchResult {
	routesDir: string;
	entries: string[];
};

export const findAllRoutes = async (routesDir: string): Promise<RouteSearchResult> => {

	const entries: string[] = [];

	const iterate = async (dir: string) => {
		const nextEntries = Deno.readDir(dir);
		for await (const item of nextEntries) {
			const itemPath = `${dir}/${item.name}`;
			if (item.isDirectory) {
				await iterate(itemPath);
			} else if (item.isFile) {
				entries.push(itemPath);
			}
		}
	};
	await iterate(routesDir);

	return {
		routesDir,
		entries: entries.filter(item => ['js', 'mjs', 'ts', 'mts'].some(ext => item.endsWith(`.${ext}`)))
	};
};

export const applyConfig = (config: RouteConfig): Partial<RouteCtx> => ({
	rateLimiter: config.ratelimit === false ? null : (Object.keys(config.ratelimit || {}).length ? new RateLimiter(config.ratelimit) : undefined),
	originChecker: config.allowedOrigings === false ? null :(config.allowedOrigings?.length ? new OriginChecker(config.allowedOrigings) : undefined)
});

export const loadRoutes = async (from: RouteSearchResult): Promise<Record<string, RouteCtx>> => {

	const result: Record<string, RouteCtx> = {};

	for (const entry of from.entries) {

		try {

			const importPath = /^([A-z]\:)?[\\\/]/.test(entry) ? entry : `${Deno.cwd()}/${entry}`;
			const importURL = `file:///` + importPath.replace(/[\\\/]+/g, '/').replace(/\/[^\/]+\/[\.]{2}\//g, '/').replace(/\/\.\//g, '/');

			console.log(`%c --> Loading function %c${entry}\n\t (resolved: ${importURL})`, 'color: blue', 'color: white');

			const imported = await import(importURL);	
	
			const handler = (imported['default'] || imported['handler']);
			if (!handler || typeof handler !== 'function') throw new Error('No handler exported');
	
			const config = (imported['config'] || {}) as RouteConfig;
			if (typeof config !== 'object') throw new Error('Config invalid');

			const pathNoExt = entry.slice(from.routesDir.length, entry.lastIndexOf('.'));
			const indexIndex = pathNoExt.lastIndexOf('/index');
			const fsRoutedUrl = indexIndex === -1 ? pathNoExt : (indexIndex === 0 ? '/' : pathNoExt.slice(0, indexIndex));
			const customUrl = config.url?.replace(/[\/\*]+$/, '');

			const pathname = typeof customUrl === 'string' ? customUrl : fsRoutedUrl;
			if (!pathname.startsWith('/')) throw new Error(`Invalid route url: ${pathname}`);

			const expandPathByUrl = config.url?.endsWith('*');
			const expandFlagProvided = typeof config.expand === 'boolean';
			if (expandPathByUrl && expandFlagProvided) {
				console.warn(`Module %c"${entry}"%c has both expanding path and %cconfig.expand%c set, the last will be used`, 'color: yellow', 'color: inherit', 'color: yellow', 'color: inherit');
			}

			result[pathname] = Object.assign({
				handler,
				url: {
					pathname,
					expand: expandFlagProvided ? config.expand : (expandPathByUrl || false)
				}
			}, applyConfig(config));

		} catch (error) {
			throw new Error(`Failed to import route module ${entry}: ${(error as Error).message}`);
		}
	}

	console.log(`%cLoaded ${from.entries.length} functions`, 'color: green')

	return result;
};
