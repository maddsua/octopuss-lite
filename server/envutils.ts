
export const getNumber = (envVar: string | null | undefined, fallback?: number) => {
	if (!envVar?.length) return typeof fallback === 'number' ? fallback : undefined;
	const temp = parseFloat(envVar);
	if (isNaN(temp)) return typeof fallback === 'number' ? fallback : undefined;
	return temp;
};

export const getBool = (envVar: string | null | undefined, fallback?: boolean) => {
	if (!envVar?.length) return typeof fallback === 'boolean' ? fallback : false;
	return envVar.toLowerCase().trim() === 'true';
}

export const getCommaSeparated = (envVar: string | null | undefined) =>  {
	if (!envVar?.length) return [];
	return envVar.split(',').map(item => item.trim()).filter(item => !!item.length);
};
