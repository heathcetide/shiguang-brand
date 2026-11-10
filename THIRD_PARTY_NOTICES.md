# Third-party notices

DietDigiDose includes or redistributes the following third-party material. The project-level MIT license does not replace the licenses listed here.

## Project-created AI-generated media

- File: `server/public/community/tofu-seaweed-soup.png`
- Purpose: bundled demonstration image for a seeded community post
- Provenance: generated with OpenAI's image generation service on July 31, 2026

The PNG contains content-provenance metadata identifying `gpt-image` as the software agent, `trainedAlgorithmicMedia` as the digital source type, and OpenAI Media Service as the signer. It was generated for this project rather than copied from a third-party photo library. This entry is included for provenance transparency; the image is not presented as a photograph of a real meal.

## HeroUI Native

- Upstream: <https://github.com/heroui-inc/heroui-native>
- Location: `client/heroui/`
- License: Apache License 2.0
- Copyright: HeroUI contributors

The vendored component source is integrated locally. A copy of the Apache License 2.0 is provided at [`LICENSES/Apache-2.0.txt`](LICENSES/Apache-2.0.txt). Copyright, attribution and license comments already present in individual source files must be retained. Record the upstream revision and mark modified files when updating this directory.

## HowToCook

- Upstream: <https://github.com/Anduin2017/HowToCook>
- Locations: `server/public/recipes/howtocook/`, `admin/public/landing/meal-bowl.png`, and records imported with `source = howtocook`
- License: The Unlicense
- Copyright: HowToCook contributors

Imported records preserve the upstream source URL, source revision and data license in the database. A copy of the upstream license is provided at [`LICENSES/Unlicense.txt`](LICENSES/Unlicense.txt).

## USDA FoodData Central and TFDA nutrition references

- Locations: scoped nutrition references in `datasets/releases/system-data-2026-09-15.2.zip`, `datasets/releases/concept-enrichment-2026-10-02.1.zip` and `datasets/releases/concept-enrichment-2026-10-03.1.zip`, and source observations in `datasets/base-data/evidence/`
- USDA FoodData Central: CC0 1.0, as declared in the [official API guide](https://fdc.nal.usda.gov/api-guide/). Attribution: U.S. Department of Agriculture, Agricultural Research Service, FoodData Central. Preserve each record's FDC ID, data type, source URL and snapshot information.
- Taiwan Food and Drug Administration: Government Data Open License, version 1, as declared by the [official dataset catalogue](https://data.gov.tw/dataset/8543). Preserve sample identifiers, source descriptions and nutrient units.

These are scoped reference samples, not measurements of every similarly named ingredient. Missing values remain unknown. Source-evidence coverage and the remaining gaps are documented in [data-sources.md](docs/data-sources.md).

## Space Mono

- Upstream: <https://github.com/googlefonts/spacemono>
- Location: `client/assets/fonts/SpaceMono-Regular.ttf`
- License: SIL Open Font License 1.1
- Copyright: The Space Mono Project Authors

A copy of the SIL Open Font License is provided at [`LICENSES/OFL-1.1.txt`](LICENSES/OFL-1.1.txt).

## Other embedded notices

Some files under `client/heroui/` include code derived from projects such as Radix Primitives or color utility libraries under MIT-compatible licenses. Their existing SPDX, copyright and attribution headers are part of this distribution and must not be removed.

Remote images referenced by URL, including Unsplash URLs used by the admin interface, are not stored in this repository and remain subject to their providers' terms.
