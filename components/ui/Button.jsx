export function Button({ variant="solid", className="", ...props }) {
    const base = variant === "outline" ? "btn btn-outline" : "btn";
    return <button className={`${base} ${className}`} {...props} />;
}
