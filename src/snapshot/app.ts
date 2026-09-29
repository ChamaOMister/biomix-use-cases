/**
 * Browser entry of the report snapshot, bundled by esbuild into the single HTML file. It reads the
 * embedded data and re-renders both report sections whenever a filter changes. The page is fully
 * rendered for the unfiltered view already, so it stays readable without JavaScript.
 *
 * It touches only `getElementById`, form fields' `value`, `addEventListener` and `innerHTML`, so
 * the tests can run the bundled file against a small stand-in for the DOM.
 */
import { expandSnapshotLines, type SnapshotData } from "./data.ts";
import { FILTER_FIELDS, readFilters, renderResults, type FilterField } from "./render.ts";

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Snapshot element #${id} is missing`);
  return element;
}

const data = JSON.parse(byId("snapshot-data").textContent ?? "") as SnapshotData;
const lines = expandSnapshotLines(data);
const form = byId("filters") as HTMLFormElement;
const results = byId("results");
const field = (name: FilterField) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement;

function update(): void {
  results.innerHTML = renderResults(lines, readFilters((name) => field(name).value));
}

form.addEventListener("change", update);
form.addEventListener("submit", (event) => {
  event.preventDefault();
  update();
});
byId("clear").addEventListener("click", () => {
  for (const name of FILTER_FIELDS) field(name).value = "";
  update();
});
update();
