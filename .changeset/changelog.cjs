// Content-only release notes: no PR, commit, or "Thanks @author" attribution.

const getReleaseLine = async (changeset) => {
	const [firstLine, ...rest] = changeset.summary.split("\n").map((line) => line.trimEnd());
	const body = rest.map((line) => (line ? `  ${line}` : "")).join("\n");
	return `\n\n- ${firstLine}${body ? `\n${body}` : ""}`;
};

const getDependencyReleaseLine = async (_changesets, dependenciesUpdated) => {
	if (dependenciesUpdated.length === 0) return "";
	const updated = dependenciesUpdated.map((dep) => `  - ${dep.name}@${dep.newVersion}`).join("\n");
	return `\n\n- Updated dependencies:\n${updated}`;
};

module.exports = { getReleaseLine, getDependencyReleaseLine };
