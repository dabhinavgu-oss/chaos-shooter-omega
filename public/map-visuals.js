/* Distinct visual identities for the 12 lobby maps. Geometry stays server-authoritative so movement/ground alignment remains safe. */
(() => {
  const themes = {
    delta:     { sky:0x7fb5d6, fog:0x7fb5d6, grass:0x6f9f45, dirt:0x76502c, stone:0x777777, accent:0x9b2d20 },
    frost:     { sky:0xbfe8ff, fog:0xbfe8ff, grass:0xd8eef2, dirt:0x9bb4bd, stone:0xb9c6cc, accent:0x62b9e8 },
    inferno:   { sky:0x321414, fog:0x321414, grass:0x8b3821, dirt:0x51251b, stone:0x3b3434, accent:0xff6b22 },
    void:      { sky:0x130b27, fog:0x130b27, grass:0x3e315e, dirt:0x28203d, stone:0x494052, accent:0xa45cff },
    sanctuary: { sky:0x9fd8a4, fog:0x9fd8a4, grass:0x78b95c, dirt:0x80603d, stone:0x9b9b8b, accent:0xffdf70 },
    neon:      { sky:0x10162e, fog:0x10162e, grass:0x2d806f, dirt:0x27384a, stone:0x5b637d, accent:0xff36d7 },
    ruins:     { sky:0xbba889, fog:0xbba889, grass:0x8c8050, dirt:0x765d42, stone:0x7e776d, accent:0xd8c17a },
    harbor:    { sky:0x5f87a8, fog:0x5f87a8, grass:0x587a58, dirt:0x66594a, stone:0x66727a, accent:0x4dd8ff },
    mine:      { sky:0x171717, fog:0x171717, grass:0x4b4b36, dirt:0x4a3425, stone:0x555555, accent:0xffc34a },
    lab:       { sky:0x8ea3b8, fog:0x8ea3b8, grass:0x6c8d83, dirt:0x59645f, stone:0xa0abb0, accent:0x62ffef },
    swamp:     { sky:0x344735, fog:0x344735, grass:0x4f6b31, dirt:0x463b25, stone:0x55574a, accent:0x8dff4f },
    sky:       { sky:0x78bdf0, fog:0x78bdf0, grass:0x7bb66a, dirt:0x98754d, stone:0xc0c7ce, accent:0xfff08a }
  };

  function applyMap() {
    const id = localStorage.getItem('cso_map') || 'delta';
    const t = themes[id] || themes.delta;
    if (typeof scene !== 'undefined') {
      scene.background.setHex(t.sky);
      scene.fog.color.setHex(t.fog);
    }
    if (typeof matGrass !== 'undefined') matGrass.color.setHex(t.grass);
    if (typeof matDirt !== 'undefined') matDirt.color.setHex(t.dirt);
    if (typeof matStone !== 'undefined') matStone.color.setHex(t.stone);
    if (typeof sun !== 'undefined') sun.color.setHex(t.accent);
    document.body.dataset.mapTheme = id;
  }

  window.setTimeout(applyMap, 0);
  if (typeof socket !== 'undefined') socket.on('init', applyMap);
})();
