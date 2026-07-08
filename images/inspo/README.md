# Inspo Mode Images ("inspos for friends")

Each theme is a folder of meme images, listed explicitly in the `INSPO_THEMES`
array at the top of `inspo.js` (filenames are matched exactly, including
extension case — no guessing/renaming needed).

```
images/inspo/general/    → "surprise general memes"
images/inspo/monkey/     → "gibraltar monkey memes"
images/inspo/spongebob/  → "spongebob & patrick duo memes"
```

## Adding more images to a theme

1. Drop the file into the matching folder above.
2. Add its filename to that theme's `files` array in `inspo.js`, e.g.:

```js
{
  key: 'monkey',
  folder: 'images/inspo/monkey',
  label: 'gibraltar monkey memes',
  files: ['monkey1.jpg', 'monkey2.jpg', 'monkey3.jpg', 'monkey4.jpg', 'monkey5.jpg'], // ← add here
}
```

## Adding a whole new theme

Add a new object to the `INSPO_THEMES` array with a unique `key`, a `folder`
path (create the folder here alongside the others), a `label` shown to
users, a short `blurb`, and the `files` array. It'll automatically show up
as a new theme card on the layout page.
