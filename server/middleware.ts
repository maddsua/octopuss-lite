import { findAllRoutes, loadRoutes, type Context } from "./routes.ts";
import { JSONResponse } from "./api.ts";
import { OriginChecker, OriginManagerOptions } from "./originManager.ts";
import { RateLimiter, RateLimiterOptions } from "./rateLimiter.ts";

interface OctopussOptions {
	routesDir: string;
	proxy?: {
		forwardedIP?: string;
	},
	rateLimiter?: RateLimiterOptions;
	origin?: OriginManagerOptions;
};

interface StartServerOptions {
	serve?: Deno.ServeOptions | Deno.ServeTlsOptions;
	octo?: OctopussOptions;
};

export const startServer = async (opts?: StartServerOptions) => {

	let searchDir = opts?.octo?.routesDir || 'src/routes';

	const handlers = await findAllRoutes(searchDir);
	if (!handlers.entries.length) throw new Error(`Failed to load route modules: no modules found in "${searchDir}"`);

	const routesPool = await loadRoutes(handlers);

	const rateLimiter: RateLimiter | null = opts?.octo?.rateLimiter?.enabled ? new RateLimiter(opts.octo.rateLimiter) : null;
	const originChecker: OriginChecker | null = opts?.octo?.origin?.enabled && opts.octo.origin.origins?.length ? new OriginChecker(opts.octo.origin.origins) : null;

	const middlewareHandler: Deno.ServeHandler = async (request, info) => {

		const { pathname } = new URL(request.url);
		const pathComponents = pathname.slice(1).split('/');

		let routectx = routesPool[pathname];

		if (!routectx) {
			for (let idx = pathComponents.length - 1; idx >= 0; idx--) {

				const nextRoute = '/' + pathComponents.slice(0, idx).join('/');
				const nextCtx = routesPool[nextRoute];

				if (nextCtx?.url.expand) {
					routectx = nextCtx;
					break;
				}
			}
		}

		if (!routectx) {
			return new JSONResponse({
				error_text: 'route not found'
			}, { status: 404 }).toResponse();
		}

		try {
			const handlerResponse = await routectx.handler(request, {} as Context);
			return handlerResponse instanceof JSONResponse ? handlerResponse.toResponse() : handlerResponse;
		} catch (error) {
			console.error('Octo middleware error:', (error as Error).message || error);
			return new JSONResponse({
				error_text: 'unhandled middleware error'
			}, { status: 500 }).toResponse();
		}
	};

	const httpRequestHandler: Deno.ServeHandler = async (request, info) => {
		const middleware = await middlewareHandler(request, info);
		middleware.headers.set('x-powered-by', 'octopuss');
		return middleware;
	};

	if (!opts?.serve) {
		Deno.serve(httpRequestHandler);
		return
	}

	Deno.serve(opts?.serve, middlewareHandler);
};
