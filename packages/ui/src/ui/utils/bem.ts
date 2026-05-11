/**
 * BEM helper — port of grid-ui's `BEM()`.
 *
 * Lets components write:
 *   const b = BEM("button", styles);
 *   <button className={b({ active, primary, size: "m" })} />
 *   <span className={b("label")} />
 *
 * The function looks up resulting class names against the imported
 * `*.module.scss` map so we get scoped classes for free.
 */

type ModifierMap = Record<string, boolean | string | undefined | null>;
type ModList = Array<string | undefined | boolean>;

const flattenModifiers = (modifiers: ModifierMap): string[] =>
  Object.keys(modifiers)
    .filter((k) => modifiers[k])
    .map((k) => (typeof modifiers[k] === "string" ? `${k}-${modifiers[k]}` : k));

export const toModifiers = (list: ModList): ModifierMap =>
  list.filter((_) => !!_).reduce<ModifierMap>((acc, mod) => ({ ...acc, [mod as string]: true }), {});

export interface BEMFn {
  (element?: string, modifiers?: ModifierMap | ModList): BEMResult;
  (modifiers: ModifierMap | ModList): BEMResult;
}

export interface BEMResult {
  toString(): string;
  /** Append additional class names. */
  and(extra: string | undefined | false): string;
  /** Extract `props.className` and merge it onto this BEM result. */
  extend<T extends { className?: string }>(props: T): string;
}

const wrapResult = (className: string): BEMResult & string => {
  // We deliberately use a String wrapper so the result is both string-coerce-able
  // and carries our helper methods. React reads `.toString()` for className, but
  // some places (e.g. classnames spread) want a real string — `.toString()` works.
  // eslint-disable-next-line @typescript-eslint/no-wrapper-object-types
  const wrapper = new String(className) as String & BEMResult & string;
  wrapper.toString = () => className;
  wrapper.and = (extra: string | undefined | false) => (extra ? `${className} ${extra}` : className);
  wrapper.extend = <T extends { className?: string }>(props: T) =>
    props.className ? `${className} ${props.className}` : className;
  return wrapper;
};

const ELEMENT_SEPARATOR = "__";
const MODIFIER_SEPARATOR = "--";

export function BEM(blockName: string, styles: Record<string, string> = {}): BEMFn {
  const lookup = (raw: string) =>
    raw
      .split(" ")
      .filter(Boolean)
      .map((c) => styles[c] ?? c)
      .join(" ");

  const fn = (elementOrModifiers?: string | ModifierMap | ModList, modifiers?: ModifierMap | ModList): BEMResult => {
    const element = typeof elementOrModifiers === "string" ? elementOrModifiers : undefined;
    const rawMods: ModifierMap | ModList | undefined =
      typeof elementOrModifiers === "string" ? modifiers : (elementOrModifiers as ModifierMap | ModList | undefined);
    const modifierMap: ModifierMap = Array.isArray(rawMods) ? toModifiers(rawMods as ModList) : (rawMods ?? {});

    const base = element ? `${blockName}${ELEMENT_SEPARATOR}${element}` : blockName;
    const modifierList = flattenModifiers(modifierMap);
    const classes = [base, ...modifierList.map((m) => `${base}${MODIFIER_SEPARATOR}${m}`)];

    return wrapResult(lookup(classes.join(" ")));
  };

  return fn as BEMFn;
}

export function extendClassName(props: { className?: string }, className: string = ""): string {
  return props.className ? `${className} ${props.className}` : className;
}
