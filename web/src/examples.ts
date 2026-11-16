// Maps from Wikimedia Commons kept with the page (web/public/examples/), as they were on 2026-11-16, so the
// examples still show what they show if the files on Commons are fixed later. Each keeps its own licence.

export type Example = {
  slug: string;
  /** Short name for the list of examples. */
  label: string;
  file: string;
  /** The file on Commons. */
  title: string;
  author: string;
  license: string;
  licenseUrl?: string;
  /** Language version of the map that is shown (default en). */
  lang?: string;
};

export const EXAMPLES: Example[] = [
  {
    slug: "serbian-despotate",
    label: "Serbian Despotate, 1422",
    file: "serbian-despotate-1422.svg",
    title: "File:Serbian Despotate (1422)-en.svg",
    author: "Ivan25, translated by Vorziblix",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
  },
  {
    slug: "finnish-railways",
    label: "Finnish railways",
    file: "finnish-railroad-network.svg",
    title: "File:Finnish railroad network-en.svg",
    author: "Oona Räisänen (Mysid)",
    license: "Public domain",
  },
  {
    slug: "land-grant-colleges",
    label: "Land-grant colleges",
    file: "land-grant-colleges.svg",
    title: "File:Land Grant Colleges Map.svg",
    author: "USDA; vector by Cody Logan (clpo13)",
    license: "Public domain",
  },
  {
    slug: "acadian-peninsula",
    label: "Acadian Peninsula",
    file: "peninsule-acadienne.svg",
    title: "File:Peninsule acadienne (multilingue).svg",
    author: "Mikmaq",
    license: "CC BY-SA 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by-sa/3.0",
  },
];

export const commonsPage = (title: string) => `https://commons.wikimedia.org/wiki/${encodeURIComponent(title.replaceAll(" ", "_"))}`;
