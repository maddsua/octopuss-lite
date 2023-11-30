import { findAllRoutes, loadRoutes, type Context } from "./routes.ts";
import { JSONResponse } from "./api.ts";
import { OriginChecker, OriginManagerOptions } from "./originManager.ts";
import { RateLimiter, RateLimiterOptions } from "./rateLimiter.ts";

interface OctopussOptions {
	routesDir: string;
	proxy?: {
		forwardedIPHeader?: string;
		requestIdHeader?: string;
	},
	rateLimit?: RateLimiterOptions;
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

	const rateLimiter: RateLimiter | null = opts?.octo?.rateLimit?.enabled ? new RateLimiter(opts.octo.rateLimit) : null;
	const originChecker: OriginChecker | null = opts?.octo?.origin?.enabled && opts.octo.origin.origins?.length ? new OriginChecker(opts.octo.origin.origins) : null;

	const middlewareHandler: Deno.ServeHandler = async (request, info) => {

		const clientIP = (opts?.octo?.proxy?.forwardedIPHeader ? request.headers.get(opts.octo.proxy.forwardedIPHeader) : undefined) || info.remoteAddr.hostname;

		//	check rate limiter
		if (rateLimiter) {
			const rateCheck = rateLimiter.check({ ip: clientIP });
			if (!rateCheck.ok) {
				console.log(`Too many requests (${rateCheck.requests}). Wait for ${rateCheck.reset}s`);
				return new JSONResponse({
					error_text: 'too many requests'
				}, { status: 429 }).toResponse();
			}
		}

		//	check request origin
		if (originChecker) {
			const originHeader = request.headers.get('origin');
			if (!originHeader) {
				return new JSONResponse({
					error_text: 'client not verified'
				}, { status: 403 }).toResponse();

			}
			if (!originChecker.check(originHeader)) {
				console.log('Origin not allowed:', originHeader);
				return new JSONResponse({
					error_text: 'client not verified'
				}, { status: 403 }).toResponse();

			}
		}


		const requestID = (opts?.octo?.proxy?.requestIdHeader ? request.headers.get(opts.octo.proxy.requestIdHeader) : undefined) || 'test';

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
