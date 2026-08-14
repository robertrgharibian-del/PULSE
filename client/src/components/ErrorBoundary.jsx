import React from "react";

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ background: "#FFFFFF", minHeight: "100vh", color: "#1F2937", padding: "2rem", fontFamily: "monospace" }}>
          <h1 style={{ color: "#DC2626", fontSize: "1.25rem", marginBottom: "1rem" }}>Что-то сломалось на этой странице</h1>
          <p style={{ color: "#6B7280", marginBottom: "1rem" }}>
            Пришлите этот текст — по нему можно точно найти причину:
          </p>
          <pre style={{ background: "#F7F8FC", padding: "1rem", borderRadius: "8px", whiteSpace: "pre-wrap", fontSize: "0.85rem" }}>
            {String(this.state.error?.message || this.state.error)}
            {"\n\n"}
            {this.state.error?.stack}
          </pre>
          <button
            onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ marginTop: "1.5rem", background: "#ED3237", color: "#FFFFFF", padding: "0.6rem 1.2rem", borderRadius: "6px", fontWeight: "bold", border: "none" }}
          >
            Перезагрузить страницу
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
