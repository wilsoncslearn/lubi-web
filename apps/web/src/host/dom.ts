// Browser equivalents of the native DOM helpers. ESM evaluates this module once.
const P: any = Node.prototype,
  E: any = Element.prototype;
function attributes(el: any, options: any = {}) {
  if (typeof options === "string") options = { cls: options };
  if (options.cls)
    el.setAttribute(
      "class",
      Array.isArray(options.cls) ? options.cls.join(" ") : options.cls,
    );
  if (options.text !== undefined) el.textContent = String(options.text);
  for (const name of ["type", "href", "title", "placeholder"])
    if (options[name] !== undefined) el.setAttribute(name, options[name]);
  if (options.value !== undefined) el.value = options.value;
  for (const [key, value] of Object.entries(options.attr || {}))
    if (value !== null && value !== undefined)
      el.setAttribute(key, String(value));
  return el;
}
P.createEl = function (tag: string, options?: any, callback?: Function) {
  const el = attributes(document.createElement(tag), options);
  this.appendChild(el);
  callback?.(el);
  return el;
};
P.createDiv = function (options?: any, callback?: Function) {
  return this.createEl("div", options, callback);
};
P.createSpan = function (options?: any, callback?: Function) {
  return this.createEl("span", options, callback);
};
P.createSvg = function (tag: string, options?: any) {
  const el = attributes(
    document.createElementNS("http://www.w3.org/2000/svg", tag),
    options,
  );
  this.appendChild(el);
  return el;
};
P.empty = function () {
  while (this.firstChild) this.removeChild(this.firstChild);
};
P.setText = function (text: unknown) {
  this.textContent = String(text ?? "");
};
E.addClass = function (...classes: string[]) {
  this.classList.add(...classes.flatMap((c) => c.split(/\s+/)).filter(Boolean));
};
E.removeClass = function (...classes: string[]) {
  this.classList.remove(
    ...classes.flatMap((c) => c.split(/\s+/)).filter(Boolean),
  );
};
E.toggleClass = function (cls: string, value: boolean) {
  this.classList.toggle(cls, value);
};
E.hasClass = function (cls: string) {
  return this.classList.contains(cls);
};
E.setAttr = function (name: string, value: any) {
  if (value === null) this.removeAttribute(name);
  else this.setAttribute(name, String(value));
};
E.setAttrs = function (values: Record<string, unknown>) {
  for (const [k, v] of Object.entries(values)) this.setAttr(k, v);
};
E.show = function () {
  this.style.display = "";
};
E.hide = function () {
  this.style.display = "none";
};
E.setCssProps = function (values: Record<string, string>) {
  for (const [k, v] of Object.entries(values)) this.style.setProperty(k, v);
};
Object.assign(globalThis, {
  createDiv: (o?: any) => attributes(document.createElement("div"), o),
  createSpan: (o?: any) => attributes(document.createElement("span"), o),
  createEl: (tag: string, o?: any) =>
    attributes(document.createElement(tag), o),
});
