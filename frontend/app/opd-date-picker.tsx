export function OpdDatePicker({ date, today, disabled, onSelect }: {
  date: string;
  today: string;
  disabled: boolean;
  onSelect: (date: string) => void;
}) {
  function selectDate(value: string) {
    if (value && value <= today && value !== date) onSelect(value);
  }

  return (
    <>
      <label>
        Queue date{" "}
        <input type="date" value={date} max={today} disabled={disabled}
          onChange={(event) => selectDate(event.target.value)} />
      </label>{" "}
      <button type="button" disabled={disabled || date === today} onClick={() => selectDate(today)}>Today</button>
    </>
  );
}
