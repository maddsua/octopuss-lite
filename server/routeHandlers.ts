import { OriginChecker, RateLimiter, RateLimiterConfig } from "./accessControl.ts";
import type { JSONResponse } from "./api.ts";
import type { ServiceConsole } from "./console.ts";

export interface RouteConfig {
	expand?: boolean;
	url?: string;
	ratelimit?: RateLimiterConfig | false;
	allowedOrigings?: string[] | false;
};

export interface Context {
	console: ServiceConsole;
	requestIP: string;
	requestID: string | null;
};

export type RouteResponse = JSONResponse<object> | Response;
export type RouteHandler = (request: Request, context: Context) => Promise<RouteResponse> | RouteResponse;

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

export const loadRoutes = async (from: RouteSearchResult): Promise<Record<string, RouteCtx>> => {

	const result: Record<string, RouteCtx> = {};

	await Promise.all(from.entries.map(async item => {

		try {

			const importPath = /^([A-z]\:)?[\\\/]/.test(item) ? item : `${Deno.cwd()}/${item}`;
			const importURL = `file:///` + importPath.replace(/[\\\/]+/g, '/').replace(/\/[^\/]+\/[\.]{2}\//g, '/').replace(/\/\.\//g, '/');

			console.log(`%c --> Loading module %c${item}\n\t (resolved: ${importURL})`, 'color: blue', 'color: white');

			const imported = await import(importURL);	
	
			const handler = (imported['default'] || imported['handler']);
			if (!handler || typeof handler !== 'function') throw new Error('No handler exported');
	
			const config = (imported['config'] || {}) as RouteConfig;
			if (typeof config !== 'object') throw new Error('Config invalid');

			const pathNoExt = item.slice(from.routesDir.length, item.lastIndexOf('.'));
			const indexIndex = pathNoExt.lastIndexOf('/index');
			const fsRoutedUrl = indexIndex === -1 ? pathNoExt : (indexIndex === 0 ? '/' : pathNoExt.slice(0, indexIndex));
			const customUrl = config.url?.replace(/[\/\*]+$/, '');

			const pathname = typeof customUrl === 'string' ? customUrl : fsRoutedUrl;
			if (!pathname.startsWith('/')) throw new Error(`Invalid route url: ${pathname}`);

			result[pathname] = {
				handler,
				url: {
					pathname,
					expand: typeof config.expand === 'boolean' ? config.expand : (config.url?.endsWith('*') || false)
					//	big todo: add warning for a case when both bool val and url with asterist are set
				},
				rateLimiter: config.ratelimit === false ? null : (Object.keys(config.ratelimit || {}).length ? new RateLimiter(config.ratelimit) : undefined),
				originChecker: config.allowedOrigings === false ? null :(config.allowedOrigings?.length ? new OriginChecker(config.allowedOrigings) : undefined)
			} satisfies RouteCtx;

		} catch (error) {
			throw new Error(`Failed to import route module ${item}: ${(error as Error).message}`);
		}

	}));

	return result;
};
