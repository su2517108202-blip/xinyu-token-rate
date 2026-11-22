/**
 * Host half of the 心语 token 速率 bundle.
 *
 * The meter is a pure browser-half surface: it reads the Chat view snapshot and
 * the Session projections the Host already ships. Nothing here talks to the
 * network, opens files, or registers routes — the Host row exists only so the
 * bundle mounts and the Client bundle is discovered from the manifest.
 */
export function apply() {}
