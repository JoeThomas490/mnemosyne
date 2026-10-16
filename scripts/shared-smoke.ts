// Proves the shared module is importable from a Node script.
import * as shared from "../shared/index.ts";

console.log(`shared module loaded (${Object.keys(shared).length} exports)`);
