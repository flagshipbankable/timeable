# Font

`timeable-sans.woff2` is a modified copy of **Google Sans Flex**, licensed
under the SIL Open Font License 1.1 (see `OFL.txt`, which must stay with the
font). It's hosted here so the app never loads anything from Google.

What was changed, and why:

- Trimmed to Latin characters and weights 400–800, with the other design axes
  set to their defaults, so the file is about 33 KB instead of 3.9 MB.
- Renamed inside the file to "timeable Sans", because "Google Sans Flex" is a
  Google trademark and Google's notes limit using that name on modified copies.

Source: the Google Fonts collection (`ofl/googlesansflex` in
github.com/google/fonts). To rebuild, instance the variable font with
fontTools (`wght` 400–800; `ROND` 0, `opsz` 18, `slnt` 0, `wdth` 100), subset
it with `pyftsubset` to Latin plus common punctuation (keeping the `tnum`
feature for even-width numbers), save as WOFF2, and rename the family.
