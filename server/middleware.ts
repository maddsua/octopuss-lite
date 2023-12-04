import { loadFunctionsFromFS, transformHandlers, type StaticHandler, type HandlersPool } from "./routeHandlers.ts";
import { JSONResponse } from "./api.ts";
import { OriginChecker, RateLimiter, type RateLimiterConfig } from "./accessControl.ts";
import { ServiceConsole } from "./console.ts";
import { defaultConfig } from "./config.ts";

const getRequestIdFromProxy = (headers: Headers, headerName: string | null | undefined) => {
	if (!headerName) return undefined;
	const header = headers.get(headerName);
	if (!header) return undefined;
	const shortid = header.slice(0, header.indexOf('-'));
	return shortid.length <= 8 ? shortid : shortid.slice(0, 8);
};

const generateRequestId = () => {
	const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
	const randomChar = () => characters.charAt(Math.floor(Math.random() * characters.length));
	return Array.apply(null, Array(8)).map(randomChar).join('');
};

interface OctopussOptions {
	routesDir?: string;
	proxy?: {
		forwardedIPHeader?: string;
		requestIdHeader?: string;
	},
	rateLimit?: Partial<RateLimiterConfig>;
	handleCORS?: boolean;
	allowedOrigings?: string[];
	exposeRequestID?: boolean;
};

interface StartServerOptions {
	serve?: Deno.ServeOptions | Deno.ServeTlsOptions;
	octo?: OctopussOptions;
	handlers?: Record<`/${string}`, StaticHandler>;
};

export class OctoMiddlaware {

	config: Partial<OctopussOptions>;
	routesPool: HandlersPool;
	rateLimiter: RateLimiter | null;
	originChecker: OriginChecker | null;

	constructor(routesPool: HandlersPool, config?: Partial<OctopussOptions>) {
		this.routesPool = routesPool;
		this.config = config || {};
		this.rateLimiter = config?.rateLimit ? new RateLimiter(config.rateLimit) : null;
		this.originChecker = config?.allowedOrigings?.length ? new OriginChecker(config.allowedOrigings) : null;
	}

	async dispatch(request: Request, info: Deno.ServeHandlerInfo): Promise<Response> {

		const requestID = getRequestIdFromProxy(request.headers, this.config.proxy?.requestIdHeader) || generateRequestId();
		const requestIP = (this.config.proxy?.forwardedIPHeader ?
			request.headers.get(this.config.proxy.forwardedIPHeader) : undefined) ||
			info.remoteAddr.hostname;

		const requestOrigin = request.headers.get('origin');
		const handleCORS = this.config.handleCORS !== false;
		let allowedOrigin: string | null = null;
		let exposeRequestID = false;
		let requestDisplayUrl = '/';

		const console = new ServiceConsole(requestID);

		const routeResponse = await (async () => {

			const { pathname, search } = new URL(request.url);
			requestDisplayUrl = pathname + search;

			// find route function
			let routectx = this.routesPool[pathname];

			// match route function
			if (!routectx) {
				const pathComponents = pathname.slice(1).split('/');
				for (let idx = pathComponents.length - 1; idx >= 0; idx--) {
	
					const nextRoute = '/' + pathComponents.slice(0, idx).join('/');
					const nextCtx = this.routesPool[nextRoute];
	
					if (nextCtx?.expandPath) {
						routectx = nextCtx;
						break;
					}
				}
			}
	
			//	go cry in the corned if it's not found
			if (!routectx) {
				return new JSONResponse({
					error_text: 'route not found'
				}, { status: 404 }).toResponse();
			}

			//	check request origin
			const useOriginChecker = routectx.originChecker !== null ? (routectx.originChecker || this.originChecker) : null;
			if (useOriginChecker) {

				if (!requestOrigin) {
					return new JSONResponse({
						error_text: 'client not verified'
					}, { status: 403 }).toResponse();
				}
				else if (!useOriginChecker.check(requestOrigin)) {
					console.log('Origin not allowed:', requestOrigin);
					return new JSONResponse({
						error_text: 'client not verified'
					}, { status: 403 }).toResponse();
				}

				allowedOrigin = requestOrigin;
			}
			else if (requestOrigin && allowedOrigin) {
				allowedOrigin = '*';
			}

			//	check rate limiter
			const useRateLimiter = routectx.rateLimiter !== null ? (routectx.rateLimiter || this.rateLimiter) : null;
			if (useRateLimiter) {
				const rateCheck = useRateLimiter.check({ ip: requestIP });
				if (!rateCheck.ok) {
					console.log(`Too many requests (${rateCheck.requests}). Wait for ${rateCheck.reset}s`);
					return new JSONResponse({
						error_text: 'too many requests'
					}, { status: 429 }).toResponse();
				}
			}

			//	respond to CORS preflixgt
			if (request.method == 'OPTIONS' && handleCORS) {

				const requestedCorsHeaders = request.headers.get('Access-Control-Request-Headers');
				const defaultCorsHeaders = 'Origin, X-Requested-With, Content-Type, Accept';

				const requestedCorsMethod = request.headers.get('Access-Control-Request-Method');
				const defaultCorsMethods = 'GET, POST, PUT, OPTIONS, DELETE';

				return new JSONResponse(null, {
					status: 204,
					headers: {
						'Access-Control-Allow-Methods': requestedCorsMethod || defaultCorsMethods,
						'Access-Control-Allow-Headers': requestedCorsHeaders || defaultCorsHeaders,
						'Access-Control-Max-Age': '3600',
						'Access-Control-Allow-Credentials': 'true'
					}
				}).toResponse();
			}

			//	expose request id
			if (this.config.exposeRequestID) exposeRequestID = true;

			//	execute route function
			try {

				const handlerResponse = await routectx.handler(request, { console, requestID, requestIP });

				//	here we convert a non-standard response object to a standard one
				//	all non standard should provide a "toResponse" method to do that
				const responseObject = handlerResponse instanceof Response ? handlerResponse : handlerResponse.toResponse();

				//	and if after that it's still not a Response we just crash the request
				if (!(responseObject instanceof Response)) {
					const typeErrorReport = (handlerResponse && typeof handlerResponse === 'object') ?
						`object keys ({${Object.keys(handlerResponse).join(', ')}}) don't match handler response interface` :
						`variable of type "${typeof handlerResponse}" is not a valid handler response`;
					throw new Error('Invalid function response: ' + typeErrorReport);
				}

				return responseObject;

			} catch (error) {
				console.error('Octo middleware error:', (error as Error).message || error);
				return new JSONResponse({
					error_text: 'unhandled middleware error'
				}, { status: 500 }).toResponse();
			}

		})();

		//	add some headers so the shit always works
		routeResponse.headers.set('x-powered-by', 'octopuss');
		if (allowedOrigin) routeResponse.headers.set('Access-Control-Allow-Origin', allowedOrigin);
		if (exposeRequestID) routeResponse.headers.set('x-request-id', requestID);

		//	log for, you know, reasons
		console.log(`(${requestIP}) ${request.method} "${requestDisplayUrl}" --> ${routeResponse.status}`);

		return routeResponse;
	}
};

export const startServer = async (opts?: StartServerOptions) => {

	const searchDir = opts?.octo?.routesDir || defaultConfig.routesDir;

	const routesPool = opts?.handlers ? transformHandlers(opts.handlers) : await loadFunctionsFromFS(searchDir);

	const middleware = new OctoMiddlaware(routesPool, opts?.octo);

	if (!opts?.serve) {
		Deno.serve(middleware.dispatch);
		return
	}

	Deno.serve(opts?.serve, middleware.dispatch);
};
