import { validateContent } from "../src/content/validate.js";

const result = validateContent();
console.log(JSON.stringify({ status: "passed", ...result }, null, 2));
