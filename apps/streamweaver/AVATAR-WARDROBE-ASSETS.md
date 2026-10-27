# StreamWeaver Avatar Studio wardrobe assets

The Avatar Studio hair and garment picker loads only generated GLB asset files from the public output directory of [kblood/CharacterCreator](https://github.com/kblood/CharacterCreator). It does not import or execute that project's GPL-licensed generator code.

Upstream LICENSE-NOTES.md identifies its generated hair GLBs (output/hair_*.glb) and garment GLBs (output/clothing_*.glb) as **CC0-1.0**, because they are derived from CC0 MakeHuman assets and/or original project-authored data. The upstream repository documents the provenance and per-asset license catalog.

Source:
- Asset files: https://github.com/kblood/CharacterCreator/tree/master/output
- License notes: https://github.com/kblood/CharacterCreator/blob/master/LICENSE-NOTES.md
- Asset catalog and provenance: https://github.com/kblood/CharacterCreator/blob/master/output/asset_licenses.json

Runtime delivery uses jsDelivr URLs pinned to the upstream master branch. The assets are not vendored into ApolloStation. If the upstream file names or branch changes, the wardrobe picker will need its asset URLs updated. This pilot uses a fixed list of eight hairstyles and twelve clothing items and is intended for visual fit testing against StreamWeaver's existing generic male and female bodies.

Important limitation: these CC0 meshes were generated/fitted for the upstream CharacterCreator base body, not explicitly re-rigged to StreamWeaver's body skeleton. The current preview normalizes and aligns the mesh bounds to the selected body; this is a first-pass visual try-on, not a claim of perfect skinning, animation deformation, or zero clipping. The commissioned finished model remains view-only and is never modified by the wardrobe controls.
