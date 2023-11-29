
const searchDir = 'src/routes';

const findAllHandlers = async (handlersDir: string) => {
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
	await iterate(handlersDir);
	return entries.filter(item => ['js', 'mjs', 'ts', 'mts'].some(ext => item.endsWith(`.${ext}`)));
};

const loadHandlers = (modulePaths: string[]) => {

	const entries: Array<{
		path: string;
		url: string;
	}> = [];

	for (const item of modulePaths) {
		const pathname = item.slice(searchDir.length);
		console.log(pathname);
	}

	return entries;
};

const handlers = loadHandlers(await findAllHandlers(searchDir))

console.log(handlers);
