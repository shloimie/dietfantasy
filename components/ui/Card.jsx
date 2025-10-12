export function Card({ className = "", ...props }) {
    return <div className={`card ${className}`} {...props} />;
}
export function CardContent({ className = "", ...props }) {
    return <div className={`card-pad ${className}`} {...props} />;
}