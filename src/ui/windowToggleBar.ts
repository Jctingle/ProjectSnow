type WindowToggleOptions = {
  id: string;
  label: string;
  defaultVisible?: boolean;
  onVisibleChange: (visible: boolean) => void;
};

type WindowToggleController = {
  setVisible(visible: boolean): void;
  isVisible(): boolean;
};

type ChoiceOption = {
  value: string;
  label: string;
};

type TopBarChoiceSetOptions = {
  id: string;
  label: string;
  defaultValue: string;
  options: ChoiceOption[];
  onValueChange: (value: string) => void;
};

type TopBarChoiceSetController = {
  setValue(value: string): void;
  getValue(): string;
};

type RegisteredToggle = {
  id: string;
  input: HTMLInputElement;
  onVisibleChange: (visible: boolean) => void;
};

type RegisteredChoiceSet = {
  id: string;
  inputs: Map<string, HTMLInputElement>;
  onValueChange: (value: string) => void;
};

let barRoot: HTMLDivElement | null = null;
let barRow: HTMLDivElement | null = null;
const toggles = new Map<string, RegisteredToggle>();
const choiceSets = new Map<string, RegisteredChoiceSet>();

function ensureBar(): HTMLDivElement {
  if (barRoot) return barRoot;

  barRoot = document.createElement('div');
  barRoot.style.cssText =
    'position:fixed; left:0; right:0; top:0; z-index:20; display:flex; justify-content:center; pointer-events:none;';

  barRow = document.createElement('div');
  barRow.style.cssText =
    'margin:8px; width:min(960px, calc(100vw - 16px)); display:flex; flex-wrap:wrap; align-items:center; gap:8px; background:rgba(8,12,18,0.9); border:1px solid rgba(255,255,255,0.18); border-radius:6px; padding:8px 10px; color:#f0f4ff; font-family:monospace; font-size:12px; pointer-events:auto;';

  const title = document.createElement('span');
  title.textContent = 'Windows';
  title.style.cssText = 'font-weight:700; letter-spacing:0.03em; margin-right:6px;';
  barRow.appendChild(title);

  barRoot.appendChild(barRow);
  document.body.appendChild(barRoot);
  return barRoot;
}

export function registerWindowToggle(options: WindowToggleOptions): WindowToggleController {
  ensureBar();
  if (!barRow) throw new Error('window toggle bar row was not created');

  const existing = toggles.get(options.id);
  if (existing) {
    return {
      setVisible(visible: boolean) {
        existing.input.checked = visible;
        existing.onVisibleChange(visible);
      },
      isVisible() {
        return existing.input.checked;
      },
    };
  }

  const row = document.createElement('label');
  row.style.cssText =
    'display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.04); cursor:pointer; user-select:none;';

  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = options.defaultVisible ?? true;

  const text = document.createElement('span');
  text.textContent = options.label;
  row.appendChild(input);
  row.appendChild(text);

  const handleChange = (): void => {
    options.onVisibleChange(input.checked);
  };

  input.addEventListener('change', handleChange);
  barRow.appendChild(row);

  const registered: RegisteredToggle = {
    id: options.id,
    input,
    onVisibleChange: options.onVisibleChange,
  };
  toggles.set(options.id, registered);

  options.onVisibleChange(input.checked);

  return {
    setVisible(visible: boolean) {
      input.checked = visible;
      options.onVisibleChange(visible);
    },
    isVisible() {
      return input.checked;
    },
  };
}

export function registerTopBarChoiceSet(options: TopBarChoiceSetOptions): TopBarChoiceSetController {
  ensureBar();
  if (!barRow) throw new Error('window toggle bar row was not created');

  const existing = choiceSets.get(options.id);
  if (existing) {
    return {
      setValue(value: string) {
        const input = existing.inputs.get(value);
        if (!input) return;
        input.checked = true;
        existing.onValueChange(value);
      },
      getValue() {
        for (const [value, input] of existing.inputs) {
          if (input.checked) return value;
        }
        return options.defaultValue;
      },
    };
  }

  const group = document.createElement('div');
  group.style.cssText =
    'display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border-radius:4px; border:1px solid rgba(255,255,255,0.16); background:rgba(255,255,255,0.04);';

  const title = document.createElement('span');
  title.textContent = options.label;
  title.style.cssText = 'font-weight:700; letter-spacing:0.03em; margin-right:2px;';
  group.appendChild(title);

  const name = `top-bar-choice-${options.id}`;
  const inputs = new Map<string, HTMLInputElement>();

  for (const option of options.options) {
    const row = document.createElement('label');
    row.style.cssText =
      'display:inline-flex; align-items:center; gap:6px; padding:2px 4px; border-radius:4px; cursor:pointer; user-select:none;';

    const input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = option.value;
    input.checked = option.value === options.defaultValue;

    const text = document.createElement('span');
    text.textContent = option.label;
    row.appendChild(input);
    row.appendChild(text);
    input.addEventListener('change', () => {
      if (input.checked) options.onValueChange(option.value);
    });
    group.appendChild(row);
    inputs.set(option.value, input);
  }

  barRow.appendChild(group);
  const registered: RegisteredChoiceSet = {
    id: options.id,
    inputs,
    onValueChange: options.onValueChange,
  };
  choiceSets.set(options.id, registered);
  options.onValueChange(options.defaultValue);

  return {
    setValue(value: string) {
      const input = inputs.get(value);
      if (!input) return;
      input.checked = true;
      options.onValueChange(value);
    },
    getValue() {
      for (const [value, input] of inputs) {
        if (input.checked) return value;
      }
      return options.defaultValue;
    },
  };
}
