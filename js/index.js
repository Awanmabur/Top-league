
let navbar = document.querySelector('.header .navbar');
let toTopBtn = document.getElementById("toTopBtn");

// Toggle navbar on menu button click
document.querySelector('#menu-btn').onclick = () => {
    navbar.classList.toggle('active');
};

// When scrolling
window.addEventListener('scroll', () => {
    // Remove active class from navbar when scrolling
    navbar.classList.remove('active');

    // Show or hide the toTop button
    toTopBtn.style.display = document.documentElement.scrollTop > 300 ? "block" : "none";
});

// Scroll to top button functionality
toTopBtn.addEventListener("click", function() {
    scrollToTop(4000);
});

function scrollToTop(scrollDuration) {
    var scrollStep = -window.scrollY / (scrollDuration / 5),
        scrollInterval = setInterval(function() {
            if (window.scrollY != 0) {
                window.scrollBy(0, scrollStep);
            } else {
                clearInterval(scrollInterval);
            }
        }, 15);
}



// Smooth scroll manually with custom scrollStep (like your scrollToTop)
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e) {
        e.preventDefault(); // prevent default jump

        let target = document.querySelector(this.getAttribute('href'));
        if (!target) return;

        scrollToTarget(target, 4000); // set scroll duration here (milliseconds)
    });
});

function scrollToTarget(target, scrollDuration) {
    let targetPosition = target.getBoundingClientRect().top + window.pageYOffset;
    let startPosition = window.pageYOffset;
    let distance = targetPosition - startPosition;

    let scrollStep = distance / (scrollDuration / 3); // same formula style
    let scrollInterval = setInterval(function() {
        let currentScroll = window.pageYOffset;
        let isScrollingDown = distance > 0;

        if ((isScrollingDown && currentScroll >= targetPosition) || (!isScrollingDown && currentScroll <= targetPosition)) {
            // Reached or passed the target
            clearInterval(scrollInterval);
            window.scrollTo(0, targetPosition); // snap to exact position
        } else {
            window.scrollBy(0, scrollStep);
        }
    }, 3);
}




var swiper = new Swiper(".testimonial-wrapper", {
slidesPerView: 1,
slidesPerGroup: 1,
spaceBetween: 30,
loop: true,
speed: 1300,
autoplay: true,
pagination: {
  el: ".swiper-pagination",
  clickable: true
},
breakpoints: {
  768: {
    slidesPerView: 3,
    slidesPerGroup: 3
  },
  480: {
    slidesPerView: 2,
    slidesPerGroup: 1
  }
}
});




  document.addEventListener("DOMContentLoaded", function () {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, { threshold: 0.1 });

    document.querySelectorAll('.feature, .hero').forEach(el => observer.observe(el));
  });
