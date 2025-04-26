
let navbar = document.querySelector('.header .navbar');

document.querySelector('#menu-btn').onclick = () =>{
    navbar.classList.toggle('active');


window.onscroll = () =>{
    navbar.classList.remove('active');
}
 }
  // vanilla JS
var toTopBtn = document.getElementById("toTopBtn");

window.onscroll = function () {
toTopBtn.style.display = document.documentElement.scrollTop > 300 ? "block" : "none";
};

toTopBtn.addEventListener("click", function(){
scrollToTop(4000);
});
function scrollToTop(scrollDuration) {
  var scrollStep = -window.scrollY / (scrollDuration / 5),
      scrollInterval = setInterval(function(){
      if ( window.scrollY != 0 ) {
          window.scrollBy( 0, scrollStep );
      }
      else clearInterval(scrollInterval);
  },15);
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
