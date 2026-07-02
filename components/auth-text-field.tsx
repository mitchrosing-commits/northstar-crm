import type { InputHTMLAttributes } from "react";

type AuthTextFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  id: string;
  label: string;
  name: string;
};

export function AuthTextField({ className, id, label, name, ...inputProps }: AuthTextFieldProps) {
  const classNames = ["text-input", className].filter(Boolean).join(" ");

  return (
    <>
      <label className="form-label" htmlFor={id}>
        {label}
      </label>
      <input className={classNames} id={id} name={name} {...inputProps} />
    </>
  );
}
