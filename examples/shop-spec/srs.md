# ShopDemo Web Store: Software Requirements Specification

Version 1.2 · Status: approved for build

## 1. Introduction

ShopDemo is a small web store. Customers browse products, keep a cart, pay by card and follow
their orders. Administrators manage orders and refunds.

### 1.1 Actors

| Actor | Description |
|---|---|
| Customer | A registered shopper who buys products. |
| Admin | Store staff who manage orders and issue refunds. |

## 2. Authentication

- **FR-1** (High): A user shall sign in with an e-mail address and a password on the Sign-in screen.
- **FR-2** (High): Passwords shall be at least 8 characters long. The sign-in form shall state this rule under the password field.
- **FR-3** (Medium): A user who forgot the password shall request a reset link from a "Forgot password?" link and set a new password on a Reset Password screen.
- **FR-4** (High): On invalid credentials the system shall show "Invalid email or password", keep the e-mail filled in and clear the password.
- **FR-5** (High): The user shall choose a role (Customer or Admin) when signing in. Customers land on the product list; admins land on Order Management.

## 3. Catalog

- **FR-6** (High): The product list shall show each product's name, price and an "Add to cart" button.
- **FR-7** (Medium): Customers shall search products by name from a search field above the list.

## 4. Cart and checkout

- **FR-8** (High): The cart shall list items with quantity controls, a remove action and the subtotal.
- **BR-1** (Medium): Orders over $50 ship for free; the cart shall say so.
- **FR-9** (High): A "Checkout" button on the cart shall open the checkout screen.
- **FR-10** (High): Checkout shall collect a shipping address and card details.
- **FR-11** (High): "Place order" shall charge the card. On success the system shows an order confirmation with the order number. If the card is declined the system shows an error on the checkout screen and keeps the entered data.
- **FR-12** (Medium): The system shall e-mail an order confirmation to the customer. *(No user interface.)*

## 5. Orders

- **FR-13** (High): Customers shall see the status of an order as a timeline (Paid, Packed, Shipped, Delivered).
- **FR-14** (High): Admins shall see all orders in a table and change an order's status.
- **FR-15** (Medium): Admins shall issue a refund for a paid order from Order Management.
- **FR-16** (Low): Every signed-in screen shall offer a way to sign out.

## 6. Non-functional requirements

- **NFR-1** (Medium): Pages shall load in under 2 seconds on a 4G connection. *(No user interface.)*
- **NFR-2** (Medium): Screens shall meet WCAG 2.1 AA contrast. *(No user interface.)*
