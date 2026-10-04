"use client";

import styles from "./ChangeTypeButton.module.css";

export default function ChangeTypeButton() {
  const resetType = () => {
    localStorage.removeItem("jewelleryType");
    window.location.href = "/?changeType=1";
  };

  return (
    <button className={styles.button} type="button" onClick={resetType}>
      Change Type
    </button>
  );
}
