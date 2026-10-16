setInterval(() => {
  const start = Date.now();

  fetch(location.href, { cache: "no-store" })
    .then(() => {
      document.getElementById("ping").textContent = Date.now() - start;
    });
}, 900);