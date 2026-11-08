// SRS pages: the clickable prototype (the ve-proto tag). Each control goes where srs.json says it leads; a control with several
// destinations asks which one; a control with none flashes and says so. Back and the path above work like a browser's.
{
for (const root of document.querySelectorAll('.srs-proto')) {
  const data = JSON.parse(root.querySelector('.srs-pdata').textContent);
  const view = root.querySelector('.srs-pview'), crumbs = root.querySelector('.srs-crumbs'), note = root.querySelector('.srs-pnote');
  const boxes = root.querySelector('[data-p=boxes]');
  let path = [{ screen: data.start, variant: null }];
  const say = (t) => { note.textContent = t; };
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const here = () => path[path.length - 1];
  const linksFrom = ({ screen, variant }, hotspot) => {
    const all = data.links.filter((l) => l.from === screen && l.hotspot === hotspot);
    const exact = all.filter((l) => (l.variant || null) === variant);
    return exact.length ? exact : all.filter((l) => !l.variant);
  };
  const go = (l) => {
    path.push({ screen: l.to, variant: l.to_variant || null });
    draw();
    const s = data.screens[l.to];
    say(`${l.label || 'Went'} → ${s.label}${l.to_variant ? ` (${s.variants[l.to_variant].label})` : ''}${l.condition ? ` · when ${l.condition}` : ''}${l.inferred ? ' · inferred: not shown by the screenshots or the SRS' : ''}`);
  };
  const choose = (hit, links) => {
    root.querySelector('.srs-choose')?.remove();
    const box = el('div', 'srs-choose');
    box.setAttribute('role', 'menu');
    box.append(el('p', '', 'This control leads to more than one place. Which path?'));
    for (const l of links) {
      const b = el('button', '', `${data.screens[l.to].label}${l.to_variant ? ` (${data.screens[l.to].variants[l.to_variant].label})` : ''}${l.condition ? ` · ${l.condition}` : ''}`);
      b.setAttribute('role', 'menuitem');
      b.addEventListener('click', (e) => { e.stopPropagation(); box.remove(); go(l); });
      box.append(b);
    }
    hit.parentElement.append(box);
    box.style.left = `${Math.min(parseFloat(hit.style.left), 60)}%`;
    box.style.top = `calc(${parseFloat(hit.style.top) + parseFloat(hit.style.height)}% + 6px)`;
    box.querySelector('button').focus();
  };
  const draw = () => {
    const at = here(), s = data.screens[at.screen], v = at.variant ? s.variants[at.variant] : null;
    const img = (v && v.img) || s.img, size = (v && v.size) || s.size;
    view.replaceChildren();
    const title = el('div', 'srs-ptitle');
    title.append(el('h3', '', s.label));
    if (v) title.append(el('span', 'chip warn', v.label));
    for (const r of s.reqs) { const id = el('span', 'srs-id', r); id.title = data.reqs[r] || ''; title.append(id); }
    view.append(title);
    const shot = el('div', 'srs-shot');
    shot.style.cssText = `--img: var(--srs-${img}); --ar: ${size[0] / size[1]}; aspect-ratio: ${size[0]} / ${size[1]}`;
    shot.setAttribute('role', 'group');
    shot.setAttribute('aria-label', `Screen: ${s.label}`);
    for (const h of (v && v.hotspots) || s.hotspots) {
      const links = linksFrom(at, h.id);
      const hit = el('button', 'srs-hit');
      const [x, y, w, hh] = h.box;
      hit.style.cssText = `left:${x * 100}%;top:${y * 100}%;width:${w * 100}%;height:${hh * 100}%`;
      const navigates = ['button', 'link', 'tab', 'menu'].includes(h.kind);
      const dead = !links.length && !h.in_place && navigates;
      hit.setAttribute('aria-label', `${h.label || h.id}${links.length ? '' : h.in_place ? ' (acts in place)' : dead ? ' (leads nowhere)' : ` (${h.kind})`}`);
      hit.title = h.label || h.id;
      if (dead) hit.classList.add('is-dead');
      hit.addEventListener('click', (e) => {
        e.stopPropagation();
        if (links.length === 1) return go(links[0]);
        if (links.length > 1) return choose(hit, links);
        hit.classList.remove('is-flash'); void hit.offsetWidth; hit.classList.add('is-flash');
        say(h.in_place ? `“${h.label || h.id}” acts on this screen${h.note ? `: ${h.note}` : ''}.` : dead ? `“${h.label || h.id}” leads nowhere in the screenshots or the SRS: a gap.` : `“${h.label || h.id}” is a ${h.kind}; it does not change the screen.`);
      });
      shot.append(hit);
    }
    view.append(shot);
    crumbs.replaceChildren(...path.map((p) => el('span', '', data.screens[p.screen].label + (p.variant ? ` (${data.screens[p.screen].variants[p.variant].label})` : ''))));
    root.querySelector('[data-p=back]').disabled = path.length < 2;
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-p]');
    if (!b) { root.querySelector('.srs-choose')?.remove(); return; }
    if (b.dataset.p === 'back' && path.length > 1) { path.pop(); draw(); say(''); }
    if (b.dataset.p === 'restart') { path = [path[0]]; draw(); say(''); }
    if (b.dataset.p === 'boxes') { const on = boxes.getAttribute('aria-pressed') !== 'true'; boxes.setAttribute('aria-pressed', on); root.classList.toggle('show-boxes', on); }
  });
  root.addEventListener('keydown', (e) => { if (e.key === 'Escape') root.querySelector('.srs-choose')?.remove(); });
  draw();
  say('Click any control on the screen. “Show controls” outlines them; dashed ones lead nowhere.');
}
}
